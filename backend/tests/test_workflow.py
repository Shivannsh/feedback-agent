import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.pipeline import listener_input, process_job, validate_references
from app.schemas import ComparisonReport, EvidenceReview, ListenerReport
from app.store import Store

PITCH = "Schools upload their own chapter. Our team makes a video for their teachers."
IMPRESSION = {
    "mental_picture": "I pictured a school sending a chapter to a team that creates a video for its teachers.",
    "main_takeaway": "A video production service for schools.",
    "beliefs": [
        {
            "topic": "workflow",
            "interpretation": "A team produces a video from the school's chapter.",
            "basis": "stated",
            "source_segment_ids": ["s1", "s2"],
        }
    ],
    "assumptions": [],
    "uncertainties": [],
    "first_question": "How does a teacher review the video?",
}


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path)


class FakeModels:
    """An explicit test double. Production always uses the real provider."""

    def __init__(self, fail_review=False):
        self.calls = []
        self.fail_review = fail_review

    async def generate(self, attempt_id, stage, payload, schema):
        self.calls.append((stage, payload))
        if stage == "listener":
            return ListenerReport(**IMPRESSION)
        if stage == "evidence_review":
            if self.fail_review:
                raise RuntimeError("simulated service interruption")
            return EvidenceReview(
                annotations=[
                    {
                        "belief_index": 0,
                        "assessment": "supported",
                        "explanation": "Both steps were stated.",
                        "source_segment_ids": ["s1", "s2"],
                    }
                ],
                narrative_flags=[],
            )
        return ComparisonReport(
            items=[
                {
                    "takeaway_index": 0,
                    "listener_interpretation": "A production service.",
                    "alignment": "different",
                    "gap": "The listener understood a service.",
                    "suggested_clarification": "Explain that teachers use the tool themselves.",
                    "source_segment_ids": ["s2"],
                }
            ],
            priority_changes=["Clarify who operates the product."],
        )

    async def transcribe(self, attempt):
        return PITCH


def run_next(store, service):
    job = store.claim()
    assert job is not None
    asyncio.run(process_job(store, job, service))


def test_intent_never_enters_listener_or_review_requests(store):
    attempt = store.create("Test", "school", PITCH)
    secret = "SECRET INTENDED TAKEAWAY"
    store.set_intent(attempt["id"], [secret])
    store.enqueue(attempt["id"], "analyze")
    model = FakeModels()
    run_next(store, model)
    assert secret not in json.dumps(model.calls)
    assert set(model.calls[0][1]) == {"audience", "pitch_segments"}
    assert store.get(attempt["id"])["status"] == "ready"


def test_retry_preserves_original_impression(store):
    attempt = store.create("Test", "general", PITCH)
    store.enqueue(attempt["id"], "analyze")
    run_next(store, FakeModels(fail_review=True))
    failed = store.get(attempt["id"])
    assert failed["status"] == "failed"
    original = failed["listener"]
    store.enqueue(attempt["id"], "analyze")
    retry = FakeModels()
    run_next(store, retry)
    assert [stage for stage, _ in retry.calls] == ["evidence_review"]
    assert store.get(attempt["id"])["listener"] == original


def test_comparison_does_not_rewrite_listener(store):
    attempt = store.create("Test", "general", PITCH)
    store.enqueue(attempt["id"], "analyze")
    run_next(store, FakeModels())
    original = store.get(attempt["id"])["listener"]
    store.set_intent(attempt["id"], ["Teachers use the product themselves."])
    store.enqueue(attempt["id"], "compare", {"takeaways": ["stale input"]})
    model = FakeModels()
    run_next(store, model)
    result = store.get(attempt["id"])
    assert model.calls[0][1]["intended_takeaways"] == [
        "Teachers use the product themselves."
    ]
    assert result["listener"] == original
    assert result["comparison_status"] == "ready"


def test_concurrent_submission_creates_one_job(store):
    attempt = store.create("Test", "general", PITCH)
    with ThreadPoolExecutor(max_workers=8) as executor:
        ids = list(
            executor.map(lambda _: store.enqueue(attempt["id"], "analyze"), range(12))
        )
    assert len(set(ids)) == 1
    assert store.claim() is not None
    assert store.claim() is None


def test_running_job_recovered_after_restart(store):
    attempt = store.create("Test", "general", PITCH)
    store.enqueue(attempt["id"], "analyze")
    first = store.claim()
    store.recover()
    assert store.claim()["id"] == first["id"]


def test_invalid_sources_rejected():
    report = ListenerReport(**IMPRESSION)
    with pytest.raises(ValueError, match="does not exist"):
        validate_references(report, [{"id": "s1", "text": "First sentence."}])


def test_narrative_annotation_must_quote_saved_impression():
    review = EvidenceReview(
        annotations=[
            {
                "belief_index": 0,
                "assessment": "supported",
                "explanation": "Supported.",
                "source_segment_ids": ["s1"],
            }
        ],
        narrative_flags=[
            {
                "passage": "Invented quote",
                "explanation": "Invalid evidence note.",
                "source_segment_ids": [],
            }
        ],
    )
    with pytest.raises(ValueError, match="absent from the saved impression"):
        validate_references(review, [{"id": "s1", "text": PITCH}], listener=IMPRESSION)


def test_revision_projects_only_current_pitch(store):
    original = store.create("Original", "general", PITCH)
    revision = store.create(
        "Revision",
        "general",
        "A new company offers a completely different product.",
        parent_id=original["id"],
    )
    projection = listener_input(
        {**revision, "segments": [{"id": "s1", "text": revision["transcript"]}]}
    )
    assert original["id"] not in json.dumps(projection)
    assert PITCH not in json.dumps(projection)


def test_api_saves_draft_without_key_and_rejects_unknown_context(store):
    app = create_app(store, worker_enabled=False)
    settings = Settings(openai_api_key="", _env_file=None)
    with (
        patch("app.main.get_settings", return_value=settings),
        TestClient(app) as client,
    ):
        response = client.post("/attempts", json={"title": "Test", "transcript": PITCH})
        assert response.status_code == 201
        attempt_id = response.json()["id"]
        assert client.post(f"/attempts/{attempt_id}/analyze").status_code == 503
        assert client.get(f"/attempts/{attempt_id}").json()["transcript"] == PITCH
        assert (
            client.post(
                "/attempts",
                json={
                    "title": "Test",
                    "transcript": PITCH,
                    "company_context": "hidden",
                },
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/attempts",
                json={"title": "Test", "transcript": PITCH},
                headers={"Origin": "https://unrelated.example"},
            ).status_code
            == 403
        )


def test_uploaded_audio_and_deletion(store):
    with TestClient(create_app(store, worker_enabled=False)) as client:
        response = client.post(
            "/attempts/audio",
            data={"title": "Recorded test", "audience": "general"},
            files={"file": ("../../pitch.wav", b"RIFF" + b"x" * 200, "audio/wav")},
        )
        assert response.status_code == 201
        attempt = response.json()
        assert Path(attempt["audio_name"]).name == attempt["audio_name"]
        assert client.get(f"/attempts/{attempt['id']}/audio").status_code == 200
        assert client.delete(f"/attempts/{attempt['id']}").status_code == 204
        assert client.get(f"/attempts/{attempt['id']}").status_code == 404
        assert not (store.directory / "audio" / attempt["audio_name"]).exists()


def test_active_comparison_blocks_intent_changes_and_deletion(store):
    attempt = store.create("Test", "general", PITCH)
    store.set_intent(attempt["id"], ["First takeaway"])
    store.enqueue(attempt["id"], "compare")
    with pytest.raises(ValueError):
        store.set_intent(attempt["id"], ["Changed takeaway"])
    with pytest.raises(ValueError):
        store.delete(attempt["id"])


def test_blank_or_oversized_intended_takeaways_rejected(store):
    with TestClient(create_app(store, worker_enabled=False)) as client:
        attempt = client.post(
            "/attempts", json={"title": "Test", "transcript": PITCH}
        ).json()
        endpoint = f"/attempts/{attempt['id']}/intended-takeaways"
        for values in [[" "], ["x"] * 6, ["x" * 601]]:
            assert client.put(endpoint, json={"takeaways": values}).status_code == 422
