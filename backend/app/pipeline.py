import asyncio
import hashlib
import json
import re
import tempfile
import time
from pathlib import Path

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)
from pydantic import ValidationError

from .config import get_settings
from .presentations import align_words, compress_audio, visual_content, visual_ids
from .schemas import AUDIENCES, ComparisonReport, EvidenceReview, ListenerReport

PROMPTS = Path(__file__).parent / "prompts"


def segment_transcript(transcript: str) -> list[dict]:
    sentences = re.split(r"(?<=[.!?])\s+|\n+", transcript.strip())
    return [
        {"id": f"s{index + 1}", "text": sentence.strip()}
        for index, sentence in enumerate(sentences)
        if sentence.strip()
    ]


def listener_input(attempt: dict) -> dict:
    # Explicit projection is the isolation boundary. Never serialize the attempt here.
    return {
        "audience": AUDIENCES[attempt["audience"]],
        "pitch_segments": attempt["segments"],
    }


def validate_references(report, segments, listener=None, intent=None, slide_ids=()):
    valid_ids = {segment["id"] for segment in segments} | set(slide_ids)
    references = []
    if isinstance(report, ListenerReport):
        references.extend(belief.source_segment_ids for belief in report.beliefs)
        references.extend(
            assumption.trigger_segment_ids for assumption in report.assumptions
        )
        if not report.mental_picture.strip() or not report.main_takeaway.strip():
            raise ValueError("The listener returned an empty impression.")
    elif isinstance(report, EvidenceReview):
        indexes = [item.belief_index for item in report.annotations]
        if sorted(indexes) != list(range(len(listener["beliefs"]))):
            raise ValueError(
                "The evidence review did not cover each listener belief exactly once."
            )
        references.extend(item.source_segment_ids for item in report.annotations)
        for flag in report.narrative_flags:
            if not flag.passage or not any(
                flag.passage in listener[field]
                for field in ("mental_picture", "main_takeaway")
            ):
                raise ValueError(
                    "An evidence annotation quoted text absent from the saved impression."
                )
            references.append(flag.source_segment_ids)
    else:
        indexes = [item.takeaway_index for item in report.items]
        if sorted(indexes) != list(range(len(intent))):
            raise ValueError(
                "The comparison did not cover each intended takeaway exactly once."
            )
        if len(report.priority_changes) > 3:
            raise ValueError("The comparison returned too many priority changes.")
        references.extend(item.source_segment_ids for item in report.items)
    if any(reference not in valid_ids for group in references for reference in group):
        raise ValueError("The response cited a transcript segment that does not exist.")


class ModelService:
    def __init__(self, store):
        self.store = store

    async def generate(self, attempt_id, stage, payload, schema):
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError(
                "Add OPENAI_API_KEY to backend/.env, then retry this attempt."
            )
        prompt = (PROMPTS / f"{stage}.txt").read_text()
        version = hashlib.sha256(prompt.encode()).hexdigest()[:12]
        started = time.monotonic()
        async with AsyncOpenAI(
            api_key=settings.openai_api_key, timeout=120, max_retries=1
        ) as client:
            response = await client.responses.parse(
                model=settings.listener_model,
                input=[
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": visual_content(
                            self.store, self.store.get(attempt_id), payload
                        ),
                    },
                ],
                text_format=schema,
                max_output_tokens=6000,
                store=False,
            )
        usage = response.usage.model_dump() if response.usage else {}
        self.store.record_run(
            attempt_id,
            stage,
            response.model,
            version,
            round((time.monotonic() - started) * 1000),
            usage,
        )
        if response.status != "completed" or response.output_parsed is None:
            raise ValueError(
                "The model could not complete this report. The input is saved. You can retry."
            )
        return response.output_parsed

    async def transcribe(self, attempt):
        settings = get_settings()
        started = time.monotonic()
        async with AsyncOpenAI(
            api_key=settings.openai_api_key, timeout=180, max_retries=1
        ) as client:
            with (self.store.directory / "audio" / attempt["audio_name"]).open(
                "rb"
            ) as audio:
                result = await client.audio.transcriptions.create(
                    model=settings.transcription_model,
                    file=audio,
                )
        self.store.record_run(
            attempt["id"],
            "transcription",
            settings.transcription_model,
            "original-language-v1",
            round((time.monotonic() - started) * 1000),
            {},
        )
        text = result.text.strip()
        if len(text) < 30:
            raise ValueError(
                "Too little speech was transcribed. Check the recording and try a longer pitch."
            )
        if len(text) > 40000:
            raise ValueError(
                "This recording exceeds the 40,000-character transcript limit. Try a shorter pitch."
            )
        return text

    async def transcribe_presentation(self, attempt):
        settings = get_settings()
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="presentation-audio-") as temporary:
            compressed = Path(temporary) / "pitch.mp3"
            await asyncio.to_thread(
                compress_audio,
                self.store.directory / "audio" / attempt["audio_name"],
                compressed,
            )
            async with AsyncOpenAI(
                api_key=settings.openai_api_key, timeout=240, max_retries=1
            ) as client:
                with compressed.open("rb") as audio:
                    result = await client.audio.transcriptions.create(
                        model=settings.presentation_transcription_model,
                        file=audio,
                        response_format="verbose_json",
                        timestamp_granularities=["word"],
                    )
        self.store.record_run(
            attempt["id"],
            "presentation_transcription",
            settings.presentation_transcription_model,
            "word-timestamps-v1",
            round((time.monotonic() - started) * 1000),
            {},
        )
        words = [word.model_dump() for word in (result.words or [])]
        segments = align_words(words, attempt["presentation"])
        text = " ".join(segment["text"] for segment in segments)
        if len(text) > 40000:
            raise ValueError(
                "This presentation exceeds the transcript limit. Try a shorter pitch."
            )
        return text, segments


def public_error(error):
    # Provider exception text can contain private request content or credentials.
    if isinstance(error, AuthenticationError):
        return (
            "The API key was rejected. Update OPENAI_API_KEY in backend/.env and retry."
        )
    if isinstance(error, RateLimitError):
        return "The provider's quota or rate limit was reached. Check your API billing and retry."
    if isinstance(error, APIConnectionError):
        return (
            "The AI provider could not be reached. Your input is saved. Please retry."
        )
    if isinstance(error, APIStatusError):
        return "The AI provider rejected the request. Check the configured model and account access, then retry."
    if isinstance(error, ValidationError):
        return "The model returned an invalid report format. Your input is saved. Please retry."
    if isinstance(error, ValueError):
        return str(error)
    return "Processing failed. Your input and completed stages are saved. Please retry."


async def process_job(store, job, service=None):
    service = service or ModelService(store)
    attempt_id = job["attempt_id"]
    try:
        attempt = store.get(attempt_id)
        if job["kind"] == "compare":
            store.update(attempt_id, comparison_status="running")
            payload = json.loads(job["payload"])
            report = await service.generate(
                attempt_id,
                "comparison",
                {
                    "pitch_segments": attempt["segments"],
                    "listener_impression": attempt["listener"],
                    "intended_takeaways": payload["takeaways"],
                },
                ComparisonReport,
            )
            validate_references(
                report,
                attempt["segments"],
                intent=payload["takeaways"],
                slide_ids=visual_ids(attempt),
            )
            store.update(
                attempt_id, comparison=report.model_dump(), comparison_status="ready"
            )
        else:
            if not attempt["transcript"]:
                store.update(attempt_id, status="transcribing")
                if attempt.get("presentation"):
                    transcript, segments = await service.transcribe_presentation(
                        attempt
                    )
                    store.update(attempt_id, transcript=transcript, segments=segments)
                else:
                    transcript = await service.transcribe(attempt)
                    store.update(attempt_id, transcript=transcript)
                attempt = store.get(attempt_id)
            if not attempt["segments"]:
                store.update(
                    attempt_id, segments=segment_transcript(attempt["transcript"])
                )
                attempt = store.get(attempt_id)
            if not attempt["listener"]:
                store.update(attempt_id, status="listening")
                report = await service.generate(
                    attempt_id, "listener", listener_input(attempt), ListenerReport
                )
                validate_references(
                    report, attempt["segments"], slide_ids=visual_ids(attempt)
                )
                store.update(attempt_id, listener=report.model_dump())
                attempt = store.get(attempt_id)
            if not attempt["evidence"]:
                store.update(attempt_id, status="reviewing")
                review = await service.generate(
                    attempt_id,
                    "evidence_review",
                    {
                        "pitch_segments": attempt["segments"],
                        "listener_impression": attempt["listener"],
                    },
                    EvidenceReview,
                )
                validate_references(
                    review,
                    attempt["segments"],
                    listener=attempt["listener"],
                    slide_ids=visual_ids(attempt),
                )
                store.update(attempt_id, evidence=review.model_dump())
            store.update(attempt_id, status="ready", error=None)
        store.finish(job["id"])
    except asyncio.CancelledError:
        # The durable job remains running and will be recovered at the next startup.
        raise
    except Exception as error:  # noqa: BLE001 — isolate a failed job from the durable worker
        message = public_error(error)
        if job["kind"] == "compare":
            store.update(
                attempt_id, comparison_status="failed", comparison_error=message
            )
        else:
            store.update(attempt_id, status="failed", error=message)
        store.finish(job["id"], message)


async def worker_loop(store):
    while True:
        job = store.claim()
        if job:
            await process_job(store, job)
        else:
            await asyncio.sleep(0.75)
