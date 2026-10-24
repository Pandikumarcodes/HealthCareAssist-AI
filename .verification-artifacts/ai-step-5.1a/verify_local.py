"""Read-only, secret-safe configuration and preservation checks; no API calls."""
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import Config

directory = Path(__file__).parent
local = dotenv_values(ROOT / "backend" / ".env")
key = os.environ.get("GEMINI_API_KEY", local.get("GEMINI_API_KEY", "")) or ""
model = os.environ.get("GEMINI_MODEL", local.get("GEMINI_MODEL", Config.GEMINI_MODEL)) or ""
frontend_files = [path for path in (ROOT / "frontend").rglob("*")
                  if path.is_file() and "node_modules" not in path.parts]
result = {
    "model_is_exact_configured_model": model.strip() == "gemini-3.5-flash-lite",
    "sdk_version": version("google-genai"),
    "backend_key_present": bool(key.strip()),
    "key_in_frontend": any(key.encode() in path.read_bytes() for path in frontend_files) if key else None,
    "project_tier": "UNVERIFIED", "paid_billing_disabled": "UNVERIFIED",
    "model_project_availability": "UNVERIFIED", "active_limits_and_remaining_quota": "UNVERIFIED",
    "live_gemini_calls": 0,
}
before = json.loads((directory / "preservation-before.json").read_text(encoding="utf-8-sig"))
changed, missing = [], []
for name, digest in before.items():
    path = ROOT / name
    if not path.is_file():
        missing.append(name)
    elif hashlib.sha256(path.read_bytes()).hexdigest().upper() != digest.upper():
        changed.append(name)
result["preservation"] = {"checked_files": len(before), "changed": changed, "missing": missing,
                          "backend_env_unchanged": "backend/.env" not in changed + missing,
                          "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()}
result["test_reports"] = {}
for name in ("pdf-tests.xml", "backend-tests-first.xml", "backend-tests.xml", "backend-tests-confirmation.xml"):
    path = directory / name
    if path.exists():
        suite = ET.parse(path).getroot().find("testsuite")
        result["test_reports"][name] = {key: suite.attrib[key] for key in ("tests", "failures", "errors", "skipped", "time")}
        ai = [case for case in suite.findall("testcase") if case.attrib["classname"] == "backend.tests.test_ai"]
        result["test_reports"][name]["ai_tests"] = len(ai)
        result["test_reports"][name]["ai_failures"] = sum(case.find("failure") is not None or case.find("error") is not None for case in ai)
pdf_suite = ET.parse(directory / "pdf-tests.xml").getroot().find("testsuite")
passing = {case.attrib["classname"].replace(".", "/") + ".py::" + case.attrib["name"]
           for case in pdf_suite.findall("testcase") if case.find("failure") is None and case.find("error") is None}
reproduced = json.loads((directory / "reproduced-failures.json").read_text())["failed_test_ids"]
result["reproduced_failures_verified_passing"] = sum(name in passing for name in reproduced)
(directory / "local-verification.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
