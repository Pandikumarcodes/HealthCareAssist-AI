"""Preservation, retained regression IDs, counts, secret-safe final review."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


baseline = read("baseline.json")
changed = [p for p, old in baseline["digests"].items() if not (ROOT / p).is_file() or hashlib.sha256((ROOT / p).read_bytes()).hexdigest() != old]
assert changed == ["frontend/vite.config.ts"], changed
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip() == baseline["head"]
assert not subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).strip()
assert subprocess.run(["git", "diff", "--check"], cwd=ROOT).returncode == 0
backend = ET.parse(OUT / "backend-tests.xml").findall(".//testcase")
old_backend = ET.parse(ROOT / ".verification-artifacts/security-step-6.2/backend-tests.xml").findall(".//testcase")
case_id = lambda row: (row.attrib["classname"], row.attrib["name"])
assert set(map(case_id, old_backend)) <= set(map(case_id, backend))
assert len(backend) == 503 and not ET.parse(OUT / "backend-tests.xml").findall(".//failure")
frontend = read("frontend-tests.json")
old_frontend = json.loads((ROOT / ".verification-artifacts/security-step-6.2/frontend-tests-final.json").read_text(encoding="utf-8"))


def names(report):
    # Two pre-existing parameterized tests embed generated expiry timestamps.
    return {re.sub(r'"expires_at":\s*\d+(?:\.\d+)?', '"expires_at":EXPIRY', a["fullName"])
            for r in report["testResults"] for a in r["assertionResults"]}


assert names(old_frontend) <= names(frontend)
assert frontend["success"] and frontend["numPassedTests"] == 320
cross = read("cross-stack-report.json")
integrated = read("integrated-browser-report.json")
mocked = read("mocked-browser-report.json")
assert cross["verdict"] == integrated["verdict"] == mocked["verdict"] == "PASS"
assert all(cross["cleanup"].values()) and not cross["blocked_network"]
assert len(integrated["workflows"]) == 5 and len(mocked["workflows"]) == 5 and len(mocked["layouts"]) == 110
assert not integrated["exceptions"] and not integrated["blockedExternal"]
assert all(v["exit_code"] == 0 for v in read("frontend-checks.json").values())
assert read("backend-checks.json")["compilation"] == "PASS"
catalog = read("catalog-after.json")
assert catalog["read_only"] == "on" and catalog["original_database_catalog_unchanged"] and catalog["test_roles_remaining"] == 0
assert not any(p.is_dir() and (p.name.startswith("browser-profile-") or p.name.startswith("hca-63-")) for p in OUT.iterdir())
private = dotenv_values(ROOT / "backend/.env")
secrets = [v for k,v in private.items() if v and len(v) >= 8 and any(s in k for s in ("PASSWORD", "KEY", "SECRET", "DATABASE_URL"))]
deliverables = [p for p in OUT.rglob("*") if p.is_file() and p.suffix in {".py", ".mjs", ".json", ".xml", ".log", ".md"}]
deliverables += [ROOT / "docs/step-6.3-e2e-verification-report.md", ROOT / "frontend/vite.config.ts"]
leaks = [str(p.relative_to(ROOT)) for p in deliverables if p.is_file() and any(v in p.read_text(encoding="utf-8", errors="replace") for v in secrets)]
assert not leaks, "A private configuration value appeared in a deliverable"
latencies = sorted(r["ms"] for r in cross["latencies_ms"])
result = {"changed_preexisting_files": changed, "original_changes_preserved": True, "env_unchanged": True,
          "head_unchanged": True, "staging_empty": True, "secret_scan_passed": True,
          "backend_total": len(backend), "backend_categories": dict(Counter(r.attrib["classname"] for r in backend)),
          "original_backend_cases_retained": True, "frontend_total": frontend["numPassedTests"], "original_frontend_cases_retained": True,
          "postgres_http_scenarios": len(cross["checks"]), "postgres_http_requests": len(cross["latencies_ms"]),
          "mock_browser_layouts": len(mocked["layouts"]), "integrated_browser_layouts": len(integrated["layouts"]),
          "integrated_browser_journeys": len(integrated["workflows"]), "provider_mock_calls": len(cross["provider_calls"]),
          "local_api_ms": {"median": latencies[len(latencies)//2], "max": max(latencies)}, "verdict": "PASS"}
(OUT / "verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
inventory = [{"path": str(p.relative_to(ROOT)).replace('\\','/'), "bytes": p.stat().st_size} for p in OUT.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.name != "inventory.json"]
inventory.append({"path": str((OUT / "inventory.json").relative_to(ROOT)).replace('\\','/'), "purpose": "Generated exact file inventory; self-size omitted"})
(OUT / "inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
