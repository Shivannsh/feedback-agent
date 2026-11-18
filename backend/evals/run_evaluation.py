"""Run synthetic fixtures against the real configured API. Requires API credits.

Run from backend with .venv/bin/python -m evals.run_evaluation.
Outputs require human review against each fixture's review_for field.
"""

import argparse
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from app.config import get_settings
from app.pipeline import process_job
from app.store import Store


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output", type=Path, default=Path("evals/results.json"))
    args = parser.parse_args()
    if not get_settings().openai_api_key:
        raise SystemExit("Configure OPENAI_API_KEY in backend/.env first.")
    fixtures = json.loads(Path(__file__).with_name("pitches.json").read_text())
    results = []
    with TemporaryDirectory(prefix="first-listener-eval-") as directory:
        store = Store(Path(directory))
        for fixture in fixtures[: max(0, args.limit)]:
            attempt = store.create(fixture["id"], fixture["audience"], fixture["pitch"])
            store.enqueue(attempt["id"], "analyze")
            await process_job(store, store.claim())
            result = store.get(attempt["id"])
            results.append({"fixture": fixture, "result": result})
            print(f"{fixture['id']} — {result['status']}", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(
        f"Saved {len(results)} reports to {args.output}. Review the mental pictures and evidence manually."
    )
    if any(item["result"]["status"] != "ready" for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
