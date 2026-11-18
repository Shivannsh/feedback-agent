import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


def now() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, directory: Path):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "listener.sqlite3"
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS attempts (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    audience TEXT NOT NULL,
                    parent_id TEXT,
                    input_type TEXT NOT NULL,
                    audio_name TEXT,
                    transcript TEXT NOT NULL DEFAULT '',
                    segments TEXT,
                    status TEXT NOT NULL DEFAULT 'draft',
                    error TEXT,
                    listener TEXT,
                    evidence TEXT,
                    intent TEXT NOT NULL DEFAULT '[]',
                    intent_revision INTEGER NOT NULL DEFAULT 0,
                    comparison TEXT,
                    comparison_status TEXT NOT NULL DEFAULT 'idle',
                    comparison_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    error TEXT,
                    created_at TEXT NOT NULL,
                    finished_at TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_job
                    ON jobs(attempt_id, kind) WHERE status IN ('queued', 'running');
                CREATE TABLE IF NOT EXISTS model_runs (
                    id TEXT PRIMARY KEY,
                    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
                    stage TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt_version TEXT NOT NULL,
                    latency_ms INTEGER NOT NULL,
                    usage TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS decks (
                    id TEXT PRIMARY KEY,
                    content_hash TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    pages TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(attempts)")}
            for name in ("presentation", "recording_id"):
                if name not in columns:
                    db.execute(f"ALTER TABLE attempts ADD COLUMN {name} TEXT")
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS recording_submission ON attempts(recording_id) WHERE recording_id IS NOT NULL"
            )

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(
        self,
        title,
        audience,
        transcript="",
        audio_name=None,
        parent_id=None,
        presentation=None,
    ):
        attempt_id = str(uuid4())
        with self.connection() as db:
            db.execute(
                """INSERT INTO attempts
                (id,title,audience,parent_id,input_type,audio_name,transcript,created_at,updated_at,presentation,recording_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    attempt_id,
                    title,
                    audience,
                    parent_id,
                    "presentation"
                    if presentation
                    else "audio"
                    if audio_name
                    else "text",
                    audio_name,
                    transcript,
                    now(),
                    now(),
                    json.dumps(presentation) if presentation else None,
                    presentation["recording_id"] if presentation else None,
                ),
            )
        return self.get(attempt_id)

    def get(self, attempt_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM attempts WHERE id=?", (attempt_id,)
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            for field in (
                "segments",
                "listener",
                "evidence",
                "intent",
                "comparison",
                "presentation",
            ):
                result[field] = json.loads(result[field]) if result[field] else None
            result["runs"] = [
                dict(run)
                for run in db.execute(
                    "SELECT stage,model,prompt_version,latency_ms,created_at FROM model_runs WHERE attempt_id=? ORDER BY created_at",
                    (attempt_id,),
                )
            ]
            return result

    def find_recording(self, recording_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT id FROM attempts WHERE recording_id=?", (recording_id,)
            ).fetchone()
        return self.get(row["id"]) if row else None

    def get_deck(self, deck_id):
        with self.connection() as db:
            row = db.execute("SELECT * FROM decks WHERE id=?", (deck_id,)).fetchone()
        if row is None:
            return None
        deck = dict(row)
        deck["pages"] = json.loads(deck["pages"])
        return deck

    def list_decks(self):
        with self.connection() as db:
            ids = [
                row["id"]
                for row in db.execute("SELECT id FROM decks ORDER BY created_at DESC")
            ]
        return [self.get_deck(deck_id) for deck_id in ids]

    def deck_by_hash(self, content_hash):
        with self.connection() as db:
            row = db.execute(
                "SELECT id FROM decks WHERE content_hash=?", (content_hash,)
            ).fetchone()
        return self.get_deck(row["id"]) if row else None

    def save_deck(self, deck_id, content_hash, name, pages):
        with self.connection() as db:
            db.execute(
                "INSERT INTO decks VALUES (?,?,?,?,?)",
                (deck_id, content_hash, name, json.dumps(pages), now()),
            )
        return self.get_deck(deck_id)

    def list(self):
        with self.connection() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT id,title,audience,input_type,status,created_at,parent_id FROM attempts ORDER BY created_at DESC"
                )
            ]

    def update(self, attempt_id, **fields):
        allowed = {
            "transcript",
            "segments",
            "status",
            "error",
            "listener",
            "evidence",
            "comparison",
            "comparison_status",
            "comparison_error",
        }
        if not fields.keys() <= allowed:
            raise ValueError("Unsupported attempt update")
        values = [
            json.dumps(value) if isinstance(value, (dict, list)) else value
            for value in fields.values()
        ]
        assignments = ",".join(f"{field}=?" for field in fields)
        with self.connection() as db:
            db.execute(
                f"UPDATE attempts SET {assignments},updated_at=? WHERE id=?",
                (*values, now(), attempt_id),
            )

    def set_intent(self, attempt_id, takeaways):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute(
                "SELECT id FROM jobs WHERE attempt_id=? AND kind='compare' AND status IN ('queued','running')",
                (attempt_id,),
            ).fetchone()
            if active:
                raise ValueError(
                    "Wait for the current comparison to finish before editing takeaways."
                )
            db.execute(
                """UPDATE attempts SET intent=?,intent_revision=intent_revision+1,
                comparison=NULL,comparison_status='idle',comparison_error=NULL,updated_at=? WHERE id=?""",
                (json.dumps(takeaways), now(), attempt_id),
            )

    def enqueue(self, attempt_id, kind, payload=None):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT id FROM jobs WHERE attempt_id=? AND kind=? AND status IN ('queued','running')",
                (attempt_id, kind),
            ).fetchone()
            if existing:
                return existing["id"]
            attempt = db.execute(
                "SELECT status,comparison_status,intent,intent_revision FROM attempts WHERE id=?",
                (attempt_id,),
            ).fetchone()
            if kind == "analyze" and attempt["status"] == "ready":
                return None
            if kind == "compare" and attempt["comparison_status"] == "ready":
                return None
            if kind == "compare":
                # Snapshot intent inside this transaction so concurrent edits cannot
                # attach an old comparison to a new set of takeaways.
                payload = {
                    "takeaways": json.loads(attempt["intent"]),
                    "revision": attempt["intent_revision"],
                }
            job_id = str(uuid4())
            db.execute(
                "INSERT INTO jobs(id,attempt_id,kind,payload,created_at) VALUES (?,?,?,?,?)",
                (job_id, attempt_id, kind, json.dumps(payload or {}), now()),
            )
            if kind == "analyze":
                db.execute(
                    "UPDATE attempts SET status='queued',error=NULL,updated_at=? WHERE id=?",
                    (now(), attempt_id),
                )
            else:
                db.execute(
                    "UPDATE attempts SET comparison_status='queued',comparison_error=NULL,updated_at=? WHERE id=?",
                    (now(), attempt_id),
                )
            return job_id

    def recover(self):
        with self.connection() as db:
            db.execute("UPDATE jobs SET status='queued' WHERE status='running'")

    def claim(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (row["id"],))
            return dict(row)

    def finish(self, job_id, error=None):
        with self.connection() as db:
            db.execute(
                "UPDATE jobs SET status=?,error=?,finished_at=? WHERE id=?",
                ("failed" if error else "complete", error, now(), job_id),
            )

    def record_run(self, attempt_id, stage, model, version, latency, usage):
        with self.connection() as db:
            db.execute(
                "INSERT INTO model_runs VALUES (?,?,?,?,?,?,?,?)",
                (
                    str(uuid4()),
                    attempt_id,
                    stage,
                    model,
                    version,
                    latency,
                    json.dumps(usage),
                    now(),
                ),
            )

    def delete(self, attempt_id):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute(
                "SELECT id FROM jobs WHERE attempt_id=? AND status IN ('queued','running')",
                (attempt_id,),
            ).fetchone()
            if active:
                raise ValueError(
                    "Wait for processing to finish before deleting this attempt."
                )
            db.execute("DELETE FROM attempts WHERE id=?", (attempt_id,))
