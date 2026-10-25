"""Compare file digests without emitting configuration values."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


if sys.argv[1] == "capture":
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    paths = [p for p in paths if p] + ["backend/.env"]
    baseline = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
                "status": subprocess.check_output(["git", "status", "--short"], cwd=ROOT).decode(),
                "digests": {p: digest(ROOT / p) for p in paths}}
    (OUT / "baseline.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    print(f"Captured {len(paths)} file digests; no configuration values emitted.")
else:
    baseline = json.loads((OUT / "baseline.json").read_text(encoding="utf-8"))
    changed = [p for p, old in baseline["digests"].items() if digest(ROOT / p) != old]
    protected = [p for p in baseline["digests"] if p == "backend/.env" or p.startswith("backend/migrations/")
                 or p in {"backend/app/pdf_validation.py", "backend/app/pdf_extraction.py", "backend/app/pdf_limits.py",
                          "backend/app/document_processing.py", "backend/requirements.txt", "frontend/package.json", "frontend/package-lock.json"}]
    result = {"changed": changed, "protected_files_unchanged": all(p not in changed for p in protected),
              "head_unchanged": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip() == baseline["head"],
              "missing": [p for p, old in baseline["digests"].items() if old is not None and not (ROOT / p).is_file()]}
    (OUT / "preservation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    assert result["protected_files_unchanged"] and result["head_unchanged"] and not result["missing"]
