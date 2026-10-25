"""Offline compilation/dependency/startup checks using the existing environment."""
import compileall
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
result = {"python": sys.version.split()[0]}
for directory in ("backend/app", "backend/tests", "backend/scripts", "backend/migrations"):
    assert compileall.compile_dir(root / directory, quiet=1)
result["compilation"] = "PASS"
check = subprocess.run([sys.executable, "-m", "pip", "check"], cwd=root, capture_output=True, text=True)
print(check.stdout)
assert check.returncode == 0
result["dependencies"] = "PASS"
startup = subprocess.run([sys.executable, "-m", "pytest", "-q", "backend/tests/test_pdf_worker_startup.py",
                          "--junitxml=.verification-artifacts/security-step-6.2/pdf-startup.xml"], cwd=root)
assert startup.returncode == 0
result["pdf_worker_startup"] = "PASS"
(Path(__file__).parent / "backend-checks.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
