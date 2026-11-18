import asyncio
import fcntl
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import get_settings
from .pipeline import worker_loop
from .presentation_routes import presentation_routes
from .schemas import Audience, CreateAttempt, IntentInput
from .store import Store


def create_app(store=None, worker_enabled=None):
    settings = get_settings()
    store = store or Store(settings.data_dir)
    enabled = settings.worker_enabled if worker_enabled is None else worker_enabled

    @asynccontextmanager
    async def lifespan(app):
        task = None
        lock = None
        if enabled:
            lock = (store.directory / "worker.lock").open("a")
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                lock.close()
                raise RuntimeError(
                    "This local app supports one backend worker. Stop the other backend process."
                )
            store.recover()
            task = asyncio.create_task(worker_loop(store))
        yield
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if lock:
            lock.close()

    app = FastAPI(title="First Listener", lifespan=lifespan)
    app.state.store = store
    app.include_router(presentation_routes(store))
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"]
    )

    allowed_origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
    if settings.public_origin:
        allowed_origins.add(settings.public_origin)

    @app.middleware("http")
    async def check_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in allowed_origins:
            return JSONResponse(
                {
                    "detail": "This app only accepts requests from its own browser interface."
                },
                status_code=403,
            )
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    def require_attempt(attempt_id):
        attempt = store.get(attempt_id)
        if attempt is None:
            raise HTTPException(404, "Attempt not found.")
        return attempt

    def require_key():
        if not get_settings().openai_api_key.strip():
            raise HTTPException(
                503,
                "Add OPENAI_API_KEY to backend/.env, then retry. Your pitch is saved.",
            )

    @app.get("/health")
    def health():
        current = get_settings()
        return {
            "status": "ok",
            "api_key_configured": bool(current.openai_api_key.strip()),
            "listener_model": current.listener_model,
            "transcription_model": current.transcription_model,
            "presentation_transcription_model": current.presentation_transcription_model,
            "storage": "local",
            "max_audio_mb": 24,
        }

    @app.get("/attempts")
    def list_attempts():
        return store.list()

    @app.post("/attempts", status_code=201)
    def create_attempt(body: CreateAttempt):
        if body.parent_id:
            require_attempt(body.parent_id)
        return store.create(**body.model_dump())

    @app.post("/attempts/audio", status_code=201)
    async def create_audio(
        file: Annotated[UploadFile, File()],
        title: Annotated[str, Form(min_length=1, max_length=120)],
        audience: Annotated[Audience, Form()] = "general",
    ):
        title = title.strip()
        if not title:
            raise HTTPException(422, "Give this pitch a title.")
        extension = Path(file.filename or "").suffix.lower()
        if extension not in {
            ".mp3",
            ".m4a",
            ".wav",
            ".webm",
            ".ogg",
            ".flac",
            ".mp4",
            ".mpeg",
            ".mpga",
        }:
            raise HTTPException(
                415, "Choose an MP3, M4A, WAV, WebM, OGG, FLAC, or MP4 recording."
            )
        audio_dir = store.directory / "audio"
        audio_dir.mkdir(exist_ok=True)
        filename = f"{uuid4()}{extension}"
        path = audio_dir / filename
        size = 0
        try:
            with path.open("wb") as destination:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 24 * 1024 * 1024:
                        raise HTTPException(
                            413, "Choose a recording smaller than 24 MB."
                        )
                    destination.write(chunk)
            if size < 100:
                raise HTTPException(422, "The recording is empty or too short.")
            return store.create(title, audience, audio_name=filename)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @app.get("/attempts/{attempt_id}")
    def get_attempt(attempt_id: str):
        return require_attempt(attempt_id)

    @app.post("/attempts/{attempt_id}/analyze", status_code=202)
    def analyze(attempt_id: str):
        require_attempt(attempt_id)
        require_key()
        store.enqueue(attempt_id, "analyze")
        return require_attempt(attempt_id)

    @app.put("/attempts/{attempt_id}/intended-takeaways")
    def set_intent(attempt_id: str, body: IntentInput):
        require_attempt(attempt_id)
        try:
            store.set_intent(attempt_id, body.takeaways)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        return require_attempt(attempt_id)

    @app.post("/attempts/{attempt_id}/compare", status_code=202)
    def compare(attempt_id: str):
        attempt = require_attempt(attempt_id)
        require_key()
        if not attempt["listener"] or not attempt["intent"]:
            raise HTTPException(
                409, "Generate a listener impression and add intended takeaways first."
            )
        store.enqueue(
            attempt_id,
            "compare",
            {"takeaways": attempt["intent"], "revision": attempt["intent_revision"]},
        )
        return require_attempt(attempt_id)

    @app.get("/attempts/{attempt_id}/audio")
    def get_audio(attempt_id: str):
        attempt = require_attempt(attempt_id)
        if not attempt["audio_name"]:
            raise HTTPException(404, "This attempt has no recording.")
        path = store.directory / "audio" / attempt["audio_name"]
        if not path.exists():
            raise HTTPException(404, "The recording file is unavailable.")
        return FileResponse(path)

    @app.delete("/attempts/{attempt_id}", status_code=204)
    def delete_attempt(attempt_id: str):
        attempt = require_attempt(attempt_id)
        try:
            store.delete(attempt_id)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        if attempt["audio_name"]:
            (store.directory / "audio" / attempt["audio_name"]).unlink(missing_ok=True)

    return app


app = create_app()
