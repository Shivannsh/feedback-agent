# First Listener

A local pitch rehearsal app. It listens with fresh company context, describes the business it pictured, and compares that saved impression with the founder's intended takeaways.

## Run locally

Requires Node.js 22+ and Python 3.11+ on macOS or Linux.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.lock.txt
cd frontend
npm ci
cd ..
cp -n backend/.env.example backend/.env
```

Add `OPENAI_API_KEY` to `backend/.env`. Configure `LISTENER_MODEL` and `TRANSCRIPTION_MODEL` there if your account uses different models. The key stays on the backend. Keep `.env` out of source control.

```sh
python3 scripts/dev.py
```

Open [First Listener](http://127.0.0.1:3000). Stop both services with Ctrl+C. Ports 3000 and 8000 need to be available. The backend reads key and model changes for each new request.

For a production frontend build, run `npm run build -- --webpack` and `npm run start` inside `frontend`. In another terminal, run `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000` from the backend directory.

## Deploy to Railway from GitHub

1. Push the project to a GitHub repository. Keep `backend/.env` and `backend/.data` local.
2. In Railway, create a project with **Deploy from GitHub repo** and select the repository. For an existing empty service, use **Settings → Source → Connect Repo**. Leave the service root at the repository root so Railway finds the Dockerfile.
3. Attach a volume at `/data` for SQLite, pitch recordings, and queued jobs. Keep the service at one replica.
4. Under **Variables**, set `OPENAI_API_KEY` and `APP_PASSWORD`. Choose a long, unique password. If your local setup overrides `LISTENER_MODEL` or `TRANSCRIPTION_MODEL`, set those values as well. Deploy the staged changes.
5. In **Settings → Networking → Public Networking**, generate an HTTPS domain. Deploy any staged changes so the running service picks up the generated domain as its permitted browser origin. Open the link and sign in as `listener` with your `APP_PASSWORD`. For a custom domain, set `PUBLIC_ORIGIN` to its full HTTPS origin with no trailing slash.
6. Submit a short test pitch, try recording or uploading audio, and confirm the saved attempt appears in History. Back up the volume before the trial expires if you want to keep the hosted data.

The hosted service is a private pilot with one shared account and history. Keep separate users' pitches on separate deployments until the app supports per-user ownership.

## Implemented phases

| Phase | Included |
|---|---|
| Text listener | Fresh model request, audience profiles, saved mental picture, structured beliefs and uncertainty |
| Comparison | Independent intended takeaways, immutable first impression, concrete suggested clarifications |
| Audio and history | Browser recording with pause, audio upload and playback, transcription, saved attempts, revision links |
| Reliability | Persistent SQLite job queue, process-restart recovery, duplicate-job protection, stage-level retries, evidence ID validation |
| Evaluation foundation | Automated workflow regression tests and ten synthetic evaluation fixtures |

## Context boundaries

`backend/app/pipeline.py` constructs the listener input from audience and transcript segments only. It never serializes the complete attempt into the listener request. The evidence reviewer receives the pitch and saved listener response. The comparison receives the intended takeaways only after the original response has been saved.

Completed stages persist before the next stage starts. Retrying an evidence review reuses the original impression. A revised or corrected transcript creates a new attempt linked to its predecessor. Comparison takeaways are snapshotted transactionally, and editing them during a running comparison returns a conflict.

Each model request starts a fresh conversation and uses `store=False`. Request metadata includes the actual model returned, a prompt content hash, usage when available, and latency. Provider account retention settings still apply.

## Storage and scope

This is a single-user local pilot. Services bind to loopback and accept local browser origins. SQLite stores attempts in `backend/.data/listener.sqlite3`. Audio files live in `backend/.data/audio`. Deleting a completed attempt removes its database records and local recording. Submitted pitch content is sent to OpenAI for processing.

Audio references currently highlight transcript passages. Playback covers the complete recording. Word-level timestamp alignment is a later enhancement. Browser microphone capture still needs a manual check with the founder's own browser and microphone.

An independent multi-user deployment needs per-user ownership, a deployment database and object storage, and an appropriate multi-process worker setup. The worker intentionally permits a single backend process using a process lock.

## Verify

```sh
cd backend
.venv/bin/python -m pytest tests -q
cd ../frontend
npm run build -- --webpack
```

Run real-model synthetic evaluations from the backend directory. This consumes API credits.

```sh
.venv/bin/python -m evals.run_evaluation --output evals/results.json
```

Review each fixture using its `review_for` guidance. Structural success alone does not establish realistic audience behavior. Collect blind first impressions from real listeners, compare their misunderstandings with the model's, and reserve unseen pitch families for final evaluation.

## Next pilot milestone

Use the founder's real pitches to assess faithfulness, material assumptions, ambiguity, and agreement with first-time human listeners. Select model and prompt versions using those observations before claiming audience realism or adding pitch scores.
