"""Start both local services. Stop both cleanly with Ctrl+C."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
python = ROOT / "backend/.venv/bin/python"
if not python.exists() or not (ROOT / "frontend/node_modules").exists():
    sys.exit("Install the backend and frontend dependencies using README.md first.")

processes = []


def stop(*_):
    for process in processes:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
    sys.exit(0)


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
processes.append(
    subprocess.Popen(
        [
            str(python),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=ROOT / "backend",
        start_new_session=True,
    )
)
processes.append(
    subprocess.Popen(
        ["npm", "run", "dev", "--", "--webpack"],
        cwd=ROOT / "frontend",
        start_new_session=True,
    )
)
print("First Listener is starting at http://127.0.0.1:3000", flush=True)
while all(process.poll() is None for process in processes):
    time.sleep(1)
stop()
