import asyncio
import io
import json
import wave
from uuid import uuid4

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.pipeline import listener_input, process_job, validate_references
from app.presentations import (
    align_words,
    prepare_deck,
    slide_visits,
    visual_content,
    visual_ids,
)
from app.schemas import EvidenceReview, ListenerReport, PresentationInput
from app.store import Store


def timeline(deck_id=None):
    # Slide 2 is shown only while paused; slide 1 is revisited after slide 3.
    rows = [
        ("start", 1, 0, 0),
        ("slide", 3, 2, 2),
        ("pause", 3, 4, 4),
        ("slide", 2, 4, 6),
        ("slide", 3, 4, 8),
        ("resume", 3, 4, 12),
        ("slide", 1, 6, 14),
        ("finish", 1, 8, 16),
    ]
    return {
        "deck_id": deck_id or str(uuid4()),
        "recording_id": str(uuid4()),
        "duration": 8,
        "events": [
            dict(zip(("type", "slide", "time", "wall_time"), row)) for row in rows
        ],
    }


def pdf_bytes(pages=3):
    doc = pdfium.PdfDocument.new()
    try:
        for _ in range(pages):
            page = doc.new_page(640, 360)
            page.close()
        result = io.BytesIO()
        doc.save(result)
        return result.getvalue()
    finally:
        doc.close()


def wav_bytes(seconds=8):
    result = io.BytesIO()
    with wave.open(result, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(seconds * 16000))
    return result.getvalue()


def test_alignment_preserves_revisits_and_omits_paused_only_slide():
    value = PresentationInput(**timeline()).model_dump()
    visits = slide_visits(value)
    assert [(v["slide"], v["start"], v["end"]) for v in visits] == [
        (1, 0, 2),
        (3, 2, 4),
        (3, 4, 6),
        (1, 6, 8),
    ]
    words = [
        {"word": word, "start": start, "end": start + 0.3}
        for word, start in [
            ("School", 0.2),
            ("teachers", 0.6),
            ("upload", 2.1),
            ("review", 4.1),
            ("approve", 6.1),
        ]
    ]
    segments = align_words(words, value)
    assert [s["slide_id"] for s in segments] == [
        "slide-1",
        "slide-3",
        "slide-3",
        "slide-1",
    ]
    assert [s["visit_id"] for s in segments] == ["v1", "v2", "v3", "v4"]
    assert segments[0]["text"] == "School teachers"
    assert segments[0]["words"] == words[:2]
    with pytest.raises(ValueError, match="No spoken words"):
        align_words([], value)
    with pytest.raises(ValueError, match="invalid word timing"):
        align_words([{"word": "bad", "start": 10, "end": 11}], value)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda v: v["events"][4].update(time=5),
        lambda v: v["events"][5].update(type="pause"),
        lambda v: v["events"][-1].update(time=7),
        lambda v: v["events"][1].update(time=-1),
        lambda v: v["events"][1].update(type="resume"),
    ],
)
def test_rejects_broken_timeline(mutation):
    value = timeline()
    mutation(value)
    with pytest.raises(ValidationError):
        PresentationInput(**value)


def test_pdf_cache_and_upload_idempotency(tmp_path):
    store = Store(tmp_path)
    client = TestClient(create_app(store, worker_enabled=False))
    pdf = pdf_bytes()
    deck = client.post(
        "/decks", files={"file": ("Slides.pdf", pdf, "application/pdf")}
    ).json()
    assert len(deck["pages"]) == 3
    same = client.post(
        "/decks", files={"file": ("Renamed.pdf", pdf, "application/pdf")}
    ).json()
    assert same["id"] == deck["id"]
    image = client.get(f"/decks/{deck['id']}/slides/1")
    assert image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
    assert "private" in image.headers["cache-control"]
    assert client.get(f"/decks/{deck['id']}/slides/4").status_code == 404
    metadata = timeline(deck["id"])
    form = {
        "title": "Slides test",
        "audience": "school",
        "presentation": json.dumps(metadata),
    }
    files = {"file": ("recording.wav", wav_bytes(), "audio/wav")}
    first = client.post("/attempts/presentation", data=form, files=files)
    assert first.status_code == 201, first.text
    attempt = first.json()
    assert attempt["input_type"] == "presentation"
    assert attempt["presentation"] == metadata
    assert attempt["created_at"].startswith("20")
    second = client.post("/attempts/presentation", data=form, files=files)
    assert second.json()["id"] == attempt["id"]
    assert len(list((tmp_path / "audio").iterdir())) == 1
    metadata["events"][1]["time"] = 2.5
    form["presentation"] = json.dumps(metadata)
    assert (
        client.post("/attempts/presentation", data=form, files=files).status_code == 409
    )
    metadata["recording_id"] = str(uuid4())
    form["presentation"] = json.dumps(metadata)
    assert (
        client.post(
            "/attempts/presentation",
            data=form,
            files={"file": ("short.wav", wav_bytes(2), "audio/wav")},
        ).status_code
        == 422
    )
    assert len(list((tmp_path / "audio").iterdir())) == 1
    assert client.delete(f"/attempts/{attempt['id']}").status_code == 204
    assert not list((tmp_path / "audio").iterdir())
    assert client.get(f"/decks/{deck['id']}/slides/1").status_code == 200


def test_bad_and_oversize_page_decks_are_not_saved(tmp_path):
    store = Store(tmp_path)
    for pdf in (b"%PDF-invalid", pdf_bytes(21)):
        with pytest.raises(ValueError, match="could not be rendered"):
            prepare_deck(store, pdf, "Bad.pdf")
    assert store.list_decks() == []
    assert not list((tmp_path / "decks").iterdir())


def test_multimodal_context_excludes_intent_and_unshown_images(tmp_path):
    store = Store(tmp_path)
    deck = prepare_deck(store, pdf_bytes(), "SECRET DECK TITLE.pdf")
    attempt = store.create(
        "SECRET ATTEMPT TITLE", "general", presentation=timeline(deck["id"])
    )
    store.set_intent(attempt["id"], ["SECRET INTENT"])
    attempt = store.get(attempt["id"])
    attempt["segments"] = [
        {"id": "s1", "text": "Teachers upload chapters", "start": 0, "end": 1}
    ]
    # If the unshown slide is read, this test will fail with a missing file.
    (tmp_path / "decks" / deck["id"] / "2.jpg").unlink()
    content = visual_content(store, attempt, listener_input(attempt))
    assert sum(item["type"] == "input_image" for item in content) == 2
    assert "SECRET" not in json.dumps(content)
    assert visual_ids(attempt) == ["slide-1", "slide-3"]
    report = ListenerReport(
        mental_picture="I pictured teachers using a tool.",
        main_takeaway="A teacher tool.",
        beliefs=[
            {
                "topic": "workflow",
                "interpretation": "Teachers upload",
                "basis": "stated",
                "source_segment_ids": ["s1", "slide-3"],
            }
        ],
        assumptions=[],
        uncertainties=[],
        first_question="Who reviews?",
    )
    validate_references(report, attempt["segments"], slide_ids=visual_ids(attempt))
    report.beliefs[0].source_segment_ids = ["slide-2"]
    with pytest.raises(ValueError):
        validate_references(report, attempt["segments"], slide_ids=visual_ids(attempt))


def test_failed_visual_review_reuses_transcript_and_listener(tmp_path):
    store = Store(tmp_path)
    attempt = store.create(
        "Test", "school", audio_name="fake.wav", presentation=timeline()
    )
    calls = []

    class Models:
        fail = True

        async def transcribe_presentation(self, attempt):
            calls.append("transcription")
            segments = align_words(
                [{"word": "Teachers", "start": 0.1, "end": 0.5}],
                attempt["presentation"],
            )
            return "Teachers", segments

        async def generate(self, attempt_id, stage, payload, schema):
            calls.append(stage)
            if stage == "listener":
                return ListenerReport(
                    mental_picture="I pictured a teacher.",
                    main_takeaway="For teachers.",
                    beliefs=[],
                    assumptions=[],
                    uncertainties=[],
                    first_question="What do they do?",
                )
            if self.fail:
                raise RuntimeError("temporary failure")
            return EvidenceReview(annotations=[], narrative_flags=[])

    service = Models()
    store.enqueue(attempt["id"], "analyze")
    asyncio.run(process_job(store, store.claim(), service))
    original = store.get(attempt["id"])
    assert original["status"] == "failed" and original["segments"][0]["start"] == 0.1
    service.fail = False
    store.enqueue(attempt["id"], "analyze")
    asyncio.run(process_job(store, store.claim(), service))
    assert calls == ["transcription", "listener", "evidence_review", "evidence_review"]
    assert store.get(attempt["id"])["listener"] == original["listener"]
    assert store.get(attempt["id"])["status"] == "ready"
