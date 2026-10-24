"""Synthetic, offline startup measurements; never loads local configuration."""
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from pypdf import PdfWriter

writer = PdfWriter()
writer.add_blank_page(width=72, height=72)
stream = BytesIO()
writer.write(stream)
probe = """
import sys, time, json
started = time.perf_counter()
import app.pdf_validation as worker
imported = time.perf_counter()
result = worker.main()
print(json.dumps(dict(import_seconds=imported-started,
                     validation_seconds=time.perf_counter()-imported, result=result)))
"""
rows = []
for iteration in range(5):
    for label, command in (("minimal", "pass"), ("validation", probe)):
        started = time.perf_counter()
        result = subprocess.run([sys.executable, "-c", command], cwd=ROOT / "backend",
                                input=stream.getvalue(), capture_output=True, timeout=30)
        row = dict(iteration=iteration, probe=label, wall_seconds=time.perf_counter()-started,
                   returncode=result.returncode)
        if label == "validation" and result.returncode == 0:
            row.update(json.loads(result.stdout))
        rows.append(row)
        print(json.dumps(row), flush=True)
phase = "after" if "--after" in sys.argv else "before"
(Path(__file__).parent / f"worker-timings-{phase}.json").write_text(json.dumps(rows, indent=2))
