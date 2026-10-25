"""Existing compilation, dependency and PDF startup checks."""
import compileall
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
result = {"python": sys.version.split()[0]}
for directory in ("backend/app", "backend/tests", "backend/scripts", "backend/migrations", ".verification-artifacts/e2e-step-6.3"):
    assert compileall.compile_dir(ROOT / directory, quiet=1)
result["compilation"] = "PASS"
dependency = subprocess.run([sys.executable, "-m", "pip", "check"], cwd=ROOT, capture_output=True, text=True)
assert dependency.returncode == 0
result["dependencies"] = dependency.stdout.strip()
startup = subprocess.run([sys.executable, "-m", "pytest", "-q", "backend/tests/test_pdf_worker_startup.py", "--junitxml=.verification-artifacts/e2e-step-6.3/pdf-startup.xml"], cwd=ROOT)
assert startup.returncode == 0
result["pdf_worker_startup"] = "2 passed"
(OUT / "backend-checks.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
