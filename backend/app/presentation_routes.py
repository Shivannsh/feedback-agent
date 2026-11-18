import asyncio
import sqlite3
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError

from .presentations import check_recording, prepare_deck
from .schemas import Audience, PresentationInput


def presentation_routes(store):
    router = APIRouter()

    def require_deck(deck_id):
        deck = store.get_deck(deck_id)
        if deck is None:
            raise HTTPException(404, "Presentation deck not found.")
        return deck

    @router.get("/decks")
    def list_decks():
        return store.list_decks()

    @router.post("/decks", status_code=201)
    async def upload_deck(file: Annotated[UploadFile, File()]):
        try:
            if Path(file.filename or "").suffix.lower() != ".pdf":
                raise HTTPException(
                    415, "Export your presentation as a PDF, then upload it here."
                )
            data = await file.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise HTTPException(413, "Choose a PDF smaller than 20 MB.")
            if not data.startswith(b"%PDF-"):
                raise HTTPException(422, "This file does not appear to be a PDF.")
            return await asyncio.to_thread(
                prepare_deck, store, data, Path(file.filename).name
            )
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            await file.close()

    @router.get("/decks/{deck_id}")
    def get_deck(deck_id: str):
        return require_deck(deck_id)

    @router.get("/decks/{deck_id}/slides/{number}")
    def get_slide(deck_id: str, number: int):
        deck = require_deck(deck_id)
        if not 1 <= number <= len(deck["pages"]):
            raise HTTPException(404, "Slide not found.")
        return FileResponse(
            store.directory / "decks" / deck["id"] / f"{number}.jpg",
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=86400, immutable"},
        )

    @router.post("/attempts/presentation", status_code=201)
    async def finish_presentation(
        file: Annotated[UploadFile, File()],
        title: Annotated[str, Form(min_length=1, max_length=120)],
        presentation: Annotated[str, Form(max_length=150000)],
        audience: Annotated[Audience, Form()] = "general",
    ):
        path = None
        saved = False
        try:
            if not title.strip():
                raise HTTPException(422, "Give this pitch a title.")
            try:
                metadata = PresentationInput.model_validate_json(presentation)
            except ValidationError as error:
                raise HTTPException(
                    422,
                    "The presentation timeline is incomplete or invalid. Please record a new attempt.",
                ) from error
            deck = require_deck(metadata.deck_id)
            existing = store.find_recording(metadata.recording_id)
            if existing:
                if existing["presentation"] != metadata.model_dump():
                    raise HTTPException(
                        409,
                        "This recording identifier belongs to a different timeline.",
                    )
                return existing
            directory = store.directory / "audio"
            directory.mkdir(exist_ok=True)
            path = directory / f"{uuid4()}.wav"
            size = 0
            with path.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 30 * 1024 * 1024:
                        raise HTTPException(
                            413, "Presentation recordings can be up to 15 minutes."
                        )
                    output.write(chunk)
            await asyncio.to_thread(check_recording, path, metadata, len(deck["pages"]))
            try:
                attempt = store.create(
                    title.strip(),
                    audience,
                    audio_name=path.name,
                    presentation=metadata.model_dump(),
                )
            except sqlite3.IntegrityError:
                existing = store.find_recording(metadata.recording_id)
                if existing and existing["presentation"] == metadata.model_dump():
                    return existing
                raise
            saved = True
            return attempt
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            await file.close()
            if path and not saved:
                path.unlink(missing_ok=True)

    return router
