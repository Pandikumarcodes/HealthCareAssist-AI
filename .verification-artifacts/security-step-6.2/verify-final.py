"""Preservation, retained test IDs, secret non-disclosure and exact file inventory."""
import json
import re
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

from dotenv import dotenv_values

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent


def cases(path):
    return {(e.get("classname"), e.get("name")) for e in ET.parse(path).iter("testcase")}


def frontend(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    # Two existing parameterized auth names embed a Date.now() expiry value.
    # Normalize only that generated value, preserving every test's semantic name.
    return data, {re.sub(r'("expires_at":)\d+(?:\.\d+)?', r'\1<TIMESTAMP>', case["fullName"])
                  for file in data["testResults"] for case in file["assertionResults"]}


checks = {}
for command in ("typecheck", "lint", "build"):
    result = subprocess.run(["cmd.exe", "/d", "/c", "npm.cmd", "run", command], cwd=root / "frontend", capture_output=True, text=True)
    checks[command] = {"exit_code": result.returncode, "output": result.stdout + result.stderr}
    assert result.returncode == 0, f"Frontend {command} failed"
(out / "frontend-checks.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")

subprocess.run([sys.executable, str(out / "preservation.py"), "verify"], cwd=root, check=True)
preserved = json.loads((out / "preservation.json").read_text(encoding="utf-8"))
old_cases = cases(root / ".verification-artifacts/auth-step-6.1/backend-tests.xml")
new_cases = cases(out / "backend-tests.xml")
old_front, old_names = frontend(root / ".verification-artifacts/auth-step-6.1/frontend-tests.json")
new_front, new_names = frontend(out / "frontend-tests-final.json")
assert len(old_cases) == 490 and old_cases <= new_cases
assert old_front["numTotalTests"] == 315 and old_names <= new_names
assert new_front["success"] and new_front["numFailedTests"] == 0
browser = json.loads((out / "browser-report.json").read_text(encoding="utf-8"))
assert browser["verdict"] == "PASS" and len(browser["workflows"]) == 5

# Values stay in memory; report only a Boolean, never matches, names or values.
private = dotenv_values(root / "backend/.env")
sensitive = [v for k, v in private.items() if v and len(v) >= 8 and any(n in k.upper() for n in ("PASSWORD", "SECRET", "API_KEY", "DATABASE_URL"))]
new_files = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=root).decode().split("\0")
files = sorted(set(preserved["changed"] + [p for p in new_files if p]))
secret_free = all(not any(value in (root / path).read_text(encoding="utf-8", errors="ignore") for value in sensitive)
                  for path in files if (root / path).suffix.lower() != ".png")
assert secret_free, "Secret non-disclosure check failed"
assert subprocess.run(["git", "diff", "--check"], cwd=root).returncode == 0
summary = {"backend_tests": len(new_cases), "backend_original_cases_retained": len(old_cases),
           "frontend_tests": new_front["numPassedTests"], "frontend_original_names_retained": len(old_names),
           "browser_layouts": len(browser["layouts"]), "browser_workflows": len(browser["workflows"]),
           "secret_non_disclosure": secret_free, "protected_files_unchanged": preserved["protected_files_unchanged"],
           "head_unchanged": preserved["head_unchanged"], "frontend_checks": {key: value["exit_code"] for key, value in checks.items()}}
(out / "verification.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

files = sorted(set(files + [str((out / name).relative_to(root)).replace("\\", "/") for name in
                          ("verification.json", "inventory.json")]))
reasons = {
    "audit.md": "Issue, severity, evidence, minimal fix and regression risk table",
    "baseline.json": "Pre-edit tracked-file and private-config digests; no secret values",
    "preservation.py": "Reproducible digest and protected-file comparison",
    "preservation.json": "Final unchanged protected files, HEAD and missing-file results",
    "backend-checks.py": "Offline compilation, dependency and PDF startup runner",
    "backend-checks.json": "Python version and compilation/dependency/startup outcomes",
    "backend-tests.xml": "Full 503-case backend JUnit evidence",
    "pdf-startup.xml": "Separate two-case PDF worker startup JUnit evidence",
    "browser-check.mjs": "Existing CDP approach extended for synthetic security/accessibility/responsive journeys",
    "browser-report.json": "110 layout states, five journeys, contrast, targets and intercepted API records",
    "frontend-tests.json": "Retained unsuccessful frontend run with two timing-related failures",
    "frontend-tests-final.json": "Final successful 320-case frontend evidence",
    "frontend-checks.json": "Final TypeScript, Oxlint and production-build command outcomes",
    "verify-final.py": "Retained case IDs, secret non-disclosure, checks and exact inventory runner",
    "verification.json": "Final regression and preservation summary",
    "inventory.json": "Exact created/modified paths and reasons for every deliverable",
    "auth.py": "Malformed login validation and compatibility-safe API response headers",
    "test_security_polish.py": "Thirteen focused security regressions",
    "AppLayout.tsx": "Route main focus and expanded-navigation Escape handling",
    "AppLayout.test.tsx": "Two route/navigation focus regressions",
    "DocumentUploadForm.tsx": "One-shot focus after server field-validation failure",
    "KnowledgeBase.test.tsx": "Three field-association/focus regressions",
    "KnowledgeBasePage.tsx": "Associate search validation feedback with invalid input",
    "ai-assistant.css": "Wrap enlarged composer and header actions",
    "auth.css": "Login reflow, input height and boundary contrast",
    "dashboard.css": "Sidebar note contrast, brand/menu reflow and welcome target size",
    "requests.css": "Filter/input/secondary-button boundary contrast and minimum height",
    "knowledge-base.css": "Select boundary contrast and details target size",
    "index.css": "Shared standalone link target height/alignment",
    "demo-authentication.md": "Update hardening status and deployment gates",
    "step-6.2-implementation-report.md": "Required Step 6.2 audit, changes, verification and limitations report",
}
inventory = [{"path": path, "change": "modified" if path in preserved["changed"] else "created",
              "reason": "Synthetic screenshot for named page/width and normal or 200% text visual review" if path.endswith(".png")
                        else reasons[Path(path).name]} for path in files]
(out / "inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
print(json.dumps(summary, indent=2))
