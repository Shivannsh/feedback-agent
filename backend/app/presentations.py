import base64
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from pathlib import Path
from uuid import uuid4

import imageio_ffmpeg

from .config import BACKEND_DIR
from .schemas import PresentationInput

RENDER_LOCK = threading.Lock()


def prepare_deck(store, pdf: bytes, name: str):
    digest = hashlib.sha256(b"slides-1440-v1" + pdf).hexdigest()
    with RENDER_LOCK:
        existing = store.deck_by_hash(digest)
        if existing:
            return existing
        decks = store.directory / "decks"
        decks.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=decks, prefix="render-") as temporary:
            path = Path(temporary)
            (path / "deck.pdf").write_bytes(pdf)
            try:
                subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "app.render_pdf",
                        str(path / "deck.pdf"),
                        str(path),
                    ],
                    cwd=BACKEND_DIR,
                    check=True,
                    capture_output=True,
                    timeout=90,
                )
            except (subprocess.SubprocessError, OSError) as error:
                raise ValueError(
                    "This PDF could not be rendered. Use an unlocked PDF with 1–20 slides."
                ) from error
            pages = json.loads((path / "pages.json").read_text())
            deck_id = str(uuid4())
            destination = decks / deck_id
            shutil.copytree(path, destination)
            try:
                return store.save_deck(deck_id, digest, name[:180], pages)
            except BaseException:
                shutil.rmtree(destination)
                raise


def check_recording(path: Path, presentation: PresentationInput, page_count: int):
    if any(event.slide > page_count for event in presentation.events):
        raise ValueError("The timeline references a slide outside this deck.")
    try:
        with wave.open(str(path), "rb") as audio:
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getframerate() != 16000
            ):
                raise ValueError(
                    "Use the presentation recorder to create a mono 16 kHz recording."
                )
            duration = audio.getnframes() / audio.getframerate()
            if abs(duration - presentation.duration) > 0.15:
                raise ValueError("The audio duration and slide timeline do not match.")
            if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
                raise ValueError("The recording upload is incomplete. Please retry.")
    except (wave.Error, EOFError) as error:
        raise ValueError("The recording is not a readable WAV file.") from error


def slide_visits(presentation: dict):
    """Visits use the same sample clock as the audio. Paused wall time is excluded."""
    events = presentation["events"]
    visits = []
    active = False
    for current, following in zip(events, events[1:]):
        if current["type"] in {"start", "resume"}:
            active = True
        elif current["type"] in {"pause", "finish"}:
            active = False
        if not active or following["time"] <= current["time"]:
            continue
        visits.append(
            {
                "id": f"v{len(visits) + 1}",
                "slide_id": f"slide-{current['slide']}",
                "slide": current["slide"],
                "start": current["time"],
                "end": following["time"],
            }
        )
    return visits


def align_words(words: list[dict], presentation: dict):
    visits = slide_visits(presentation)
    if not visits:
        raise ValueError(
            "No recorded slide visits were found. Please record a new presentation."
        )
    segments = []
    previous_start = -1.0
    for word in words:
        start, end = float(word["start"]), float(word["end"])
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end < start
            or start < previous_start
            or end > presentation["duration"] + 0.25
        ):
            raise ValueError(
                "The transcription returned invalid word timing. Please retry."
            )
        previous_start = start
        text = word["word"].strip()
        if not text:
            continue
        midpoint = (start + end) / 2
        visit = next(
            (visit for visit in visits if visit["start"] <= midpoint < visit["end"]),
            visits[-1],
        )
        if (
            segments
            and segments[-1]["visit_id"] == visit["id"]
            and start - segments[-1]["start"] < 18
        ):
            segment = segments[-1]
            segment["text"] += " " + text
            segment["end"] = end
        else:
            segment = {
                "id": f"s{len(segments) + 1}",
                "text": text,
                "start": start,
                "end": end,
                "slide_id": visit["slide_id"],
                "visit_id": visit["id"],
                "words": [],
            }
            segments.append(segment)
        segment["words"].append({"word": text, "start": start, "end": end})
    if not segments:
        raise ValueError(
            "No spoken words were found in this presentation. Check the recording."
        )
    return segments


def visual_ids(attempt):
    if not attempt.get("presentation"):
        return []
    return sorted(
        {visit["slide_id"] for visit in slide_visits(attempt["presentation"])}
    )


def visual_content(store, attempt, payload):
    presentation = attempt.get("presentation")
    if not presentation:
        return json.dumps(payload, ensure_ascii=False)
    visits = slide_visits(presentation)
    payload = {
        **payload,
        "slide_visits": visits,
        "recording_events": presentation["events"],
        "timing_note": "Times are seconds of recorded audio; paused time is excluded. Word timestamps are speech-model estimates. Images are provided once per shown slide and revisited according to the timeline.",
    }
    content = [{"type": "input_text", "text": json.dumps(payload, ensure_ascii=False)}]
    for number in sorted({visit["slide"] for visit in visits}):
        path = store.directory / "decks" / presentation["deck_id"] / f"{number}.jpg"
        content.append(
            {
                "type": "input_text",
                "text": f"Visual evidence source slide-{number}. Interpret this image only during the visits listed for it.",
            }
        )
        content.append(
            {
                "type": "input_image",
                "detail": "high",
                "image_url": "data:image/jpeg;base64,"
                + base64.b64encode(path.read_bytes()).decode(),
            }
        )
    return content


def compress_audio(source: Path, destination: Path):
    try:
        subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-i",
                str(source),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                "64k",
                str(destination),
            ],
            check=True,
            capture_output=True,
            timeout=90,
        )
    except (subprocess.SubprocessError, OSError) as error:
        raise ValueError(
            "The presentation recording could not be prepared for transcription."
        ) from error
