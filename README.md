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
| Present with slides | Reusable PDF decks, microphone recording, timed slide navigation, multimodal first impression, linked slide and speech evidence |
| Reliability | Persistent SQLite job queue, process-restart recovery, duplicate-job protection, stage-level retries, evidence ID validation |
| Evaluation foundation | Automated workflow regression tests and ten synthetic evaluation fixtures |

## Context boundaries

`backend/app/pipeline.py` constructs the listener input from audience and transcript segments. For presentations, `visual_content` adds only the recorded timeline and images of slides shown during recording. Skipped slides and slides seen only while paused are excluded. Deck titles, PDF metadata, speaker notes, previous attempts and intended takeaways are excluded. It never serializes the complete attempt into the listener request. The evidence reviewer receives the same pitch evidence and saved listener response. The comparison receives the intended takeaways only after the original response has been saved.

Completed stages persist before the next stage starts. Retrying an evidence review reuses the original impression. A revised or corrected transcript creates a new attempt linked to its predecessor. Comparison takeaways are snapshotted transactionally, and editing them during a running comparison returns a conflict.

Each model request starts a fresh conversation and uses `store=False`. Request metadata includes the actual model returned, a prompt content hash, usage when available, and latency. Provider account retention settings still apply.

## Storage and scope

This is a single-user local pilot. Services bind to loopback and accept local browser origins. SQLite stores attempts in `backend/.data/listener.sqlite3`. Audio files live in `backend/.data/audio`. Deleting a completed attempt removes its database records and local recording. Submitted pitch content is sent to OpenAI for processing.

Standalone audio references highlight transcript passages and playback covers the complete recording. Presentation recordings have word timestamps, linked slides and seekable passages. Browser microphone capture still needs a manual check with the founder's own browser and microphone.

## Presenting with slides

Open **Present slides**, upload a PDF, name the pitch and select an audience. Press **Start pitch**, allow microphone access, navigate with the arrows or slide thumbnails, then press **Finish pitch**. Recording pauses omit microphone audio; both the pause and wall time remain in the event log. Feedback is generated only after finishing. A failed upload keeps the recording in the open page for retry or download. Reloading or closing an unsaved recording loses it.

- This version accepts PDF decks of 1–20 pages and up to 20 MB. Export PowerPoint/Google Slides as PDF first. Animations, embedded video and speaker notes are not reproduced.
- Recordings are limited to 15 minutes of captured audio. Use HTTPS or localhost, a browser with AudioWorklet support, and keep the presentation tab visible. Changing tabs, device interruptions and background throttling can affect browser capture; do a short microphone test on the intended device.
- PDF pages render once, in an isolated subprocess, to 1440-pixel JPEGs. Content hashes reuse decks across rehearsals. Cached decks live in `backend/.data/decks`; deleting an attempt keeps its reusable deck.
- An AudioWorklet records mono PCM and timestamps slide events from the same sample counter. The server validates the WAV duration and timeline, compresses the audio to MP3, and requests word timestamps. Words spanning a slide boundary use their midpoint; these are estimated speech timings, not exact forced alignment.
- The listener receives timed passages, slide visits and each shown image once. Revisits retain their position in the timeline. This is one model pass over the recorded sequence, not a real-time human perception model; it can still use hindsight and notice more visual detail than a person.
- `PRESENTATION_TRANSCRIPTION_MODEL=whisper-1` currently supplies `verbose_json` word timestamps. OpenAI has scheduled Whisper retirement for **February 26, 2027**. Before that date, replace this adapter with a supported timestamp-capable transcription/alignment pipeline; changing the model name alone is insufficient if its response format differs. See [OpenAI speech-to-text documentation](https://developers.openai.com/api/docs/guides/speech-to-text) and [deprecations](https://developers.openai.com/api/docs/deprecations).
- Model requests are one transcription, one combined listener pass and one evidence review. Images are reused within each request instead of sending video frames. Total latency and API cost depend on deck size, speech duration and provider load; benchmark real rehearsals before promising a turnaround time.

An independent multi-user deployment needs per-user ownership, a deployment database and object storage, and an appropriate multi-process worker setup. The worker intentionally permits a single backend process using a process lock.

## Verify

```sh
cd backend
.venv/bin/python -m pytest tests -q
cd ../frontend
node --test tests/presentation-recorder.test.mjs
npm run build -- --webpack
```

Run real-model synthetic evaluations from the backend directory. This consumes API credits.

```sh
.venv/bin/python -m evals.run_evaluation --output evals/results.json
```

Review each fixture using its `review_for` guidance. Structural success alone does not establish realistic audience behavior. Collect blind first impressions from real listeners, compare their misunderstandings with the model's, and reserve unseen pitch families for final evaluation.

## Next pilot milestone

Use the founder's real pitches to assess faithfulness, material assumptions, ambiguity, and agreement with first-time human listeners. Select model and prompt versions using those observations before claiming audience realism or adding pitch scores.
