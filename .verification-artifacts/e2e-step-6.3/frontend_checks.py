"""Run and record existing checks individually; stop on any failure."""
import json
from pathlib import Path
from shutil import copyfile
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
previous = OUT / "frontend-tests.json"
if previous.is_file() and json.loads(previous.read_text(encoding="utf-8")).get("numFailedTests"):
    copyfile(previous, OUT / "frontend-tests-intermediate.json")
result = {}
for name in ("typecheck", "lint", "build"):
    run = subprocess.run(["npm.cmd", "run", name], cwd=ROOT / "frontend", capture_output=True, text=True)
    result[name] = {"exit_code": run.returncode, "output": run.stdout + run.stderr}
    (OUT / "frontend-checks.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"{name}: {run.returncode}")
    assert run.returncode == 0
