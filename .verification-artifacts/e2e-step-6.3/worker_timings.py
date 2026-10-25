"""Diagnostic only: measure unchanged validation workers, never alter app limits."""
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
pdf = (OUT / "synthetic-policy.pdf").read_bytes()
rows = []
for index in range(12):
    start = time.perf_counter()
    try:
        run = subprocess.run([sys.executable, "-m", "app.pdf_validation"], cwd=ROOT / "backend", input=pdf, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        result = {"index": index, "exit_code": run.returncode}
    except subprocess.TimeoutExpired:
        result = {"index": index, "timeout": True}
    result["seconds"] = round(time.perf_counter()-start, 4)
    rows.append(result)
    (OUT / "worker-timings.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
print(json.dumps(rows))
