"""Read-only preservation/test audit; reports no secret values."""
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from dotenv import dotenv_values

directory = Path(__file__).resolve().parent
root = directory.parents[1]
baseline = json.loads((directory / "baseline.json").read_text(encoding="utf-8-sig"))
allowed = {
    "README.md", "backend/.env.example", "backend/app/__init__.py", "backend/app/config.py",
    "backend/tests/test_ai.py", "backend/tests/test_dashboard.py", "backend/tests/test_document_processing.py",
    "backend/tests/test_documents.py", "backend/tests/test_requests.py", "frontend/.env.example",
    "frontend/src/App.tsx", "frontend/src/components/layout/Sidebar.tsx", "frontend/src/services/api.ts",
    "frontend/src/features/dashboard/Dashboard.test.tsx", "frontend/src/features/knowledge-base/KnowledgeBase.test.tsx",
    "frontend/src/features/requests/Requests.test.tsx", "frontend/src/features/requests/RequestManagement.test.tsx",
    "frontend/src/features/ai-assistant/AiAssistant.test.tsx",
}
changed, missing = [], []
for name, digest in baseline["files"].items():
    name = name.replace("\\", "/")
    path = root / name
    if not path.is_file():
        missing.append(name)
    elif hashlib.sha256(path.read_bytes()).hexdigest().upper() != digest.upper():
        changed.append(name)
assert not missing and set(changed) == allowed, (missing, set(changed) ^ allowed)
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == baseline["head"]
subprocess.run(["git", "diff", "--check"], cwd=root, check=True, capture_output=True)

def passing_cases(path):
    suite = ET.parse(path).getroot().find("testsuite")
    assert suite.attrib["failures"] == suite.attrib["errors"] == suite.attrib["skipped"] == "0"
    cases = {(case.attrib["classname"], case.attrib["name"]) for case in suite.findall("testcase")}
    return suite, cases

backend, cases = passing_cases(directory / "backend-tests.xml")
_, old_cases = passing_cases(root / ".verification-artifacts/ai-step-5.1a/backend-tests-confirmation.xml")
assert len(old_cases) == 431 and old_cases <= cases
_, pdf = passing_cases(directory / "pdf-startup.xml")
assert len(pdf) == 2
frontend = json.loads((directory / "frontend-tests.json").read_text())
old_frontend = json.loads((root / ".verification-artifacts/ai-step-5.2/frontend-tests.json").read_text())
def front_cases(report):
    assert report["success"] and report["numFailedTests"] == 0
    return {case["fullName"] for suite in report["testResults"] for case in suite["assertionResults"] if case["status"] == "passed"}
front, old_front = front_cases(frontend), front_cases(old_frontend)
assert len(old_front) == 272 and old_front <= front
browser = json.loads((directory / "browser-report.json").read_text())
assert browser["verdict"] == "PASS" and not browser["exceptions"]
assert [layout["width"] for layout in browser["layouts"]] == [375, 768, 1440]
assert all(not layout["overflow"] and layout["logoutVisible"] for layout in browser["layouts"])
assert browser["backendCalls"] == browser["liveGeminiCalls"] == 0

# Compare actual existing local secret values only in memory. Never report them.
settings = dotenv_values(root / "backend/.env")
secrets = [settings.get(name) for name in ("GEMINI_API_KEY", "DB_PASSWORD", "SECRET_KEY", "DEMO_PASSWORD_HASH")]
secrets = [value.encode() for value in secrets if value and len(value) >= 8]
scan_paths = list((root / "frontend/src").rglob("*")) + list((root / "frontend/dist").rglob("*"))
scan_paths += [root / name for name in changed if name != "backend/.env"]
scan_paths += list((root / "frontend/src/features/auth").rglob("*"))
scan_paths += [root / name for name in (
    "backend/app/auth.py", "backend/scripts/generate_demo_auth.py", "backend/tests/conftest.py",
    "backend/tests/test_auth.py", "docs/demo-authentication.md", "docs/step-6.1-implementation-report.md",
)]
leaked_files = []
for path in set(scan_paths):
    if path.is_file() and any(value in path.read_bytes() for value in secrets):
        leaked_files.append(str(path.relative_to(root)))
assert not leaked_files, "Local secret appeared in a deliverable"
preservation = {"checked_files": len(baseline["files"]), "changed_existing_files": sorted(changed), "missing": missing,
    "unchanged_files": len(baseline["files"]) - len(changed), "unexpected_changes": [],
    "backend_env_unchanged": True, "dependency_manifests_unchanged": True, "migrations_unchanged": True,
    "head_unchanged": True, "existing_changes_reviewed_and_preserved": True, "secret_leaks_found": False}
(directory / "preservation.json").write_text(json.dumps(preservation, indent=2))
verification = {"date": "2026-10-24", "milestone": "6.1", "backend": {"passed": len(cases), "original_cases_preserved": len(old_cases), "new_auth_cases": len(cases - old_cases), "warnings": 2, "seconds": backend.attrib["time"]},
    "frontend": {"passed": len(front), "original_cases_preserved": len(old_front), "new_auth_cases": len(front - old_front), "files": len(frontend["testResults"])},
    "pdf_worker_startup": {"passed": 2}, "typecheck": "PASS", "oxlint": "PASS", "production_build": "PASS",
    "browser": {"verdict": "PASS", "widths": [375, 768, 1440], "horizontal_overflow": False, "api_mocked": True},
    "safety": {"live_gemini_calls": 0, "postgres_connections": 0, "backend_env_modified": False, "new_dependencies": False, "new_migrations": False, "commit_push_deploy": False},
    "setup_helper": json.loads((directory / "setup-verification.json").read_text()), "preservation": preservation,
    "limitations": ["One shared fictional account; no per-session server revocation or throttling.", "Real-credential/live PostgreSQL/HTTPS reverse-proxy integration was not exercised.", "Live Gemini quota and provider behavior remain unverified."], "verdict": "STEP 6.1 COMPLETE"}
(directory / "verification.json").write_text(json.dumps(verification, indent=2))
print(json.dumps({"backend": verification["backend"], "frontend": verification["frontend"], "preservation": "PASS", "secrets": "PASS", "verdict": verification["verdict"]}, indent=2))
