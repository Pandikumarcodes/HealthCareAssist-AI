"""Offline CI orchestration and sanitized evidence; no production code changes."""

import importlib
import importlib.metadata
from io import BytesIO
import json
import os
from pathlib import Path
import platform
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
OUT = Path(os.environ.get("CI_EVIDENCE", ROOT / ".verification-artifacts" / "github-linux"))


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2), encoding="utf-8")


def require_guard():
    if not getattr(sys, "_hca_ci_offline", False):
        raise RuntimeError("Run with HCA_CI_OFFLINE=1 and .github/scripts on PYTHONPATH")


def clean_checkout():
    for path in [BACKEND / ".env", *(ROOT / "frontend").glob(".env*")]:
        if path.is_file() and not path.name.endswith(".example"):
            raise RuntimeError("CI verification requires a checkout without local environment files")


def host():
    result = {"platform": platform.platform(), "python": platform.python_version(),
              "architecture": platform.machine(), "cpu_count": os.cpu_count()}
    if hasattr(os, "getloadavg"):
        result["load_average"] = os.getloadavg()
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        result["memory_kib"] = {
            key: int(value.split()[0]) for key, value in
            (line.split(":", 1) for line in meminfo.read_text().splitlines())
            if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}
        }
    return result


def versions():
    require_guard()
    clean_checkout()
    packages = {"flask": "Flask", "gunicorn": "gunicorn", "pymupdf": "PyMuPDF",
                "pypdf": "pypdf", "sqlalchemy": "SQLAlchemy", "psycopg": "psycopg",
                "httpx": "httpx", "google.genai": "google-genai"}
    installed = {}
    for module, distribution in packages.items():
        importlib.import_module(module)
        installed[distribution] = importlib.metadata.version(distribution)
    save("runtime.json", {"host": host(), "dependencies": installed,
                          "node": subprocess.check_output(["node", "--version"], text=True).strip()})
    if platform.python_version() != "3.11.9":
        raise RuntimeError("Expected Python 3.11.9")
    print("Required runtime imports passed; versions recorded.")


def backend():
    require_guard()
    clean_checkout()
    import pytest

    observations, reports, warnings = [], [], []
    current = {"test": None}
    original_popen = subprocess.Popen

    class ObservedPopen(original_popen):
        def __init__(self, command, *args, **kwargs):
            self.record = None
            worker = next((name for name in ("app.pdf_validation", "app.pdf_extraction")
                           if isinstance(command, list) and name in command and "-m" in command), None)
            started = time.perf_counter()
            if worker:
                self.record = {"test": current["test"], "worker": worker, "start": started}
                observations.append(self.record)
            try:
                super().__init__(command, *args, **kwargs)
            except Exception as error:
                if self.record is not None:
                    self.record["launch_error"] = type(error).__name__
                raise
            if self.record is not None:
                self.record.update(pid=self.pid, launch_seconds=time.perf_counter() - started)

        def communicate(self, *args, **kwargs):
            started = time.perf_counter()
            try:
                return super().communicate(*args, **kwargs)
            except subprocess.TimeoutExpired:
                if self.record is not None:
                    self.record["timeout"] = True
                raise
            finally:
                if self.record is not None:
                    self.record.setdefault("communication", []).append({
                        "seconds": time.perf_counter() - started,
                        "timeout_argument": kwargs.get("timeout"), "returncode": self.returncode})

        def __exit__(self, *args):
            started = time.perf_counter()
            try:
                return super().__exit__(*args)
            finally:
                if self.record is not None:
                    self.record.update(returncode=self.returncode,
                                       cleanup_seconds=time.perf_counter() - started,
                                       total_seconds=time.perf_counter() - self.record["start"])
                    save("backend-workers.json", observations)

    class Observer:
        def pytest_runtest_logstart(self, nodeid, location):
            current["test"] = nodeid

        def pytest_runtest_logreport(self, report):
            reports.append({"test": report.nodeid, "stage": report.when,
                            "outcome": report.outcome, "seconds": report.duration})
            save("backend-test-stages.json", reports)

        def pytest_warning_recorded(self, warning_message, when, nodeid, location):
            warnings.append({"test": nodeid, "stage": when,
                             "category": warning_message.category.__name__})

    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.Popen = ObservedPopen
    started, before = time.perf_counter(), host()
    try:
        status = pytest.main(["-ra", "--tb=short", "--durations=20",
                              "--junitxml=" + str(OUT / "backend.xml"), "backend/tests"],
                             plugins=[Observer()])
    finally:
        subprocess.Popen = original_popen
        save("backend-workers.json", observations)
        save("backend-run.json", {"elapsed_seconds": time.perf_counter() - started,
                                  "host_before": before, "host_after": host(),
                                  "warnings": warnings})
    return int(status)


def assert_response(connection, path, expected, *, json_code=None):
    connection.request("GET", path, headers={"Host": "ci.example.test"})
    response = connection.getresponse()
    data = response.read()
    if response.status != expected:
        raise AssertionError(f"Unexpected status for {path}: {response.status}, expected {expected}")
    if json_code and json.loads(data).get("code") != json_code:
        raise AssertionError(f"Unexpected JSON code for {path}")
    return data, response.getheader("Content-Type", "")


def bundle_check(sensitive):
    dist = ROOT / "frontend" / "dist"
    html = (dist / "index.html").read_bytes()
    assets = re.findall(rb'(?:src|href)="(/assets/[^\"]+)"', html)
    if not assets or not all((dist / asset.decode().lstrip("/")).is_file() for asset in assets):
        raise AssertionError("Production asset references are missing")
    patterns = [rb"AIza[0-9A-Za-z_-]{30,}", rb"sb_secret_[A-Za-z0-9_-]{16,}",
                rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                rb"postgres(?:ql)?(?:\+psycopg)?://", rb"/@vite/client"]
    for path in dist.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            if any(value and value.encode() in data for value in sensitive):
                raise AssertionError("Synthetic credential appeared in a production asset")
            if any(re.search(pattern, data) for pattern in patterns):
                raise AssertionError("Credential or development-client pattern in production assets")
    return html, [asset.decode() for asset in assets]


def smoke():
    require_guard()
    clean_checkout()
    import http.client
    from werkzeug.security import generate_password_hash

    # Keep the unused loopback port reserved until Gunicorn inherits its listener.
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    os.environ["HCA_CI_LOOPBACK_PORT"] = str(port)
    signing, password = secrets.token_hex(32), secrets.token_urlsafe(32)
    password_hash = generate_password_hash(password)
    sensitive = [signing, password, password_hash]
    checks, process, failure = [], None, None
    result = {"entrypoint": "app:create_app()", "login_exercised": False, "checks": checks}
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="hca-ci-") as storage, tempfile.TemporaryFile() as logs:
        env = dict(os.environ, SECRET_KEY=signing, DEMO_USERNAME="fictional-ci-reviewer",
                   HCA_CI_NO_DATABASE="1",
                   DEMO_PASSWORD_HASH=password_hash, PUBLIC_HOST="ci.example.test",
                   RENDER_DEPLOYMENT="true", DOCUMENT_UPLOAD_DIR=storage,
                   PDF_STORAGE_BACKEND="local", SESSION_COOKIE_SECURE="true",
                   GEMINI_API_KEY="", GOOGLE_API_KEY="", SUPABASE_URL="",
                   SUPABASE_SECRET_KEY="", SUPABASE_STORAGE_BUCKET="",
                   DATABASE_URL="postgresql+psycopg://ci:ci@127.0.0.1:9/ci?sslmode=require")
        try:
            html, assets = bundle_check(sensitive)
            process = subprocess.Popen(
                [sys.executable, "-m", "gunicorn", "--config", "gunicorn.conf.py",
                 "--bind", f"fd://{listener.fileno()}", "app:create_app()"],
                cwd=BACKEND, env=env, pass_fds=(listener.fileno(),), start_new_session=True,
                stdout=logs, stderr=logs,
            )
            listener.close()
            # Readiness polling only; never restart the server or retry a failed test.
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise AssertionError("Gunicorn exited before readiness")
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
                try:
                    health, content_type = assert_response(connection, "/api/health", 200)
                    if "application/json" not in content_type or json.loads(health)["status"] != "healthy":
                        raise AssertionError("Health is not the expected JSON")
                    break
                except (ConnectionError, TimeoutError):
                    if time.monotonic() >= deadline:
                        raise AssertionError("Gunicorn readiness deadline exceeded") from None
                    time.sleep(0.1)
                finally:
                    connection.close()
            result["startup_seconds"] = time.perf_counter() - started
            checks.append({"path": "/api/health", "status": 200})
            for path in ("/api/auth/me", "/api/documents", "/api/requests", "/api/dashboard/summary"):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                try:
                    assert_response(connection, path, 401, json_code="auth_required")
                    checks.append({"path": path, "status": 401})
                finally:
                    connection.close()
            for path in ("/", "/login", "/dashboard", "/knowledge-base", "/requests/123"):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                try:
                    data, content_type = assert_response(connection, path, 200)
                    if data != html or "text/html" not in content_type:
                        raise AssertionError("SPA fallback did not return compiled HTML")
                    checks.append({"path": path, "status": 200})
                finally:
                    connection.close()
            for path in [*assets, "/api/ci-missing", "/assets/ci-missing.js"]:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                try:
                    expected = 200 if path in assets else 404
                    data, _ = assert_response(connection, path, expected)
                    if expected == 404 and data == html:
                        raise AssertionError("Missing API/asset returned the SPA")
                    if path in assets and data != (ROOT / "frontend" / "dist" / path.lstrip("/")).read_bytes():
                        raise AssertionError("Asset response differs from compiled file")
                    checks.append({"path": path, "status": expected})
                finally:
                    connection.close()
            if process.poll() is not None:
                raise AssertionError("Gunicorn exited during smoke checks")
        except Exception as error:
            failure = error
            result["failure_category"] = type(error).__name__
        finally:
            listener.close()
            if process is not None:
                try:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    result["forced_shutdown"] = True
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                result["exit_code"] = process.returncode
                if process.returncode != 0 or result.get("forced_shutdown"):
                    failure = failure or AssertionError("Gunicorn did not shut down cleanly")
            logs.seek(0)
            text = logs.read().decode("utf-8", errors="replace")
            result["credentials_in_raw_logs"] = any(value in text for value in sensitive)
            for value in sensitive:
                text = text.replace(value, "[REDACTED]")
            (OUT / "gunicorn.log").write_text(text, encoding="utf-8")
            if result["credentials_in_raw_logs"]:
                failure = failure or AssertionError("Synthetic credential appeared in Gunicorn logs")
            result["passed"] = failure is None
            save("gunicorn.json", result)
            os.environ.pop("HCA_CI_LOOPBACK_PORT", None)
    if failure:
        raise failure
    print("Gunicorn, anonymous API responses and compiled assets passed; login not exercised.")


def pdf():
    require_guard()
    clean_checkout()
    from pypdf import PdfWriter

    buffer = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.write(buffer)
    content = buffer.getvalue()
    results, failed = [], False
    with tempfile.TemporaryDirectory(prefix="hca-pdf-") as temporary:
        source = Path(temporary) / "synthetic.pdf"
        source.write_bytes(content)
        probes = [("native-validation", "app.pdf_validation", False),
                  ("traced-validation", "app.pdf_validation", True),
                  ("traced-extraction", "app.pdf_extraction", True)]
        for name, worker, traced in probes:
            sidecar = OUT / (name + "-stages.json")
            OUT.mkdir(parents=True, exist_ok=True)
            command = ([sys.executable, str(Path(__file__).with_name("pdf_trace.py")), str(sidecar), worker]
                       if traced else [sys.executable, "-m", worker])
            extraction = worker.endswith("extraction")
            if extraction:
                command.append(str(source))
            started = time.perf_counter()
            record = {"probe": name, "timeout_seconds": 10 if extraction else 5,
                      "instrumented": traced, "host_before": host()}
            try:
                with subprocess.Popen(command, cwd=BACKEND, stdin=subprocess.PIPE,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
                    record["launch_seconds"] = time.perf_counter() - started
                    wait_start = time.perf_counter()
                    try:
                        process.communicate(input=None if extraction else content,
                                            timeout=record["timeout_seconds"])
                    except subprocess.TimeoutExpired:
                        record["timeout"] = True
                        process.kill()
                        process.communicate()
                    record["communication_and_reap_seconds"] = time.perf_counter() - wait_start
                    record["returncode"] = process.returncode
            except OSError as error:
                record["failure_category"] = type(error).__name__
            record["total_seconds"] = time.perf_counter() - started
            record["host_after"] = host()
            if sidecar.exists():
                stages = json.loads(sidecar.read_text())
                record["stages"] = stages
                record["spawn_to_first_python_seconds"] = stages["python_entry"] - started
                for label, begin, end in [
                    ("module_import_seconds", "module_import_start", "module_import_end"),
                    ("parser_import_seconds", "pymupdf_import_start" if extraction else "pypdf_import_start",
                     "pymupdf_import_end" if extraction else "pypdf_import_end"),
                    ("pdf_open_initial_parse_seconds", "pdf_open_start", "pdf_open_end"),
                    ("worker_main_seconds", "validation_start", "validation_end"),
                ]:
                    if begin in stages and end in stages:
                        record[label] = stages[end] - stages[begin]
            failed |= record.get("returncode") != 0 or record.get("timeout", False)
            results.append(record)
            save("pdf-timing.json", results)
    if failed:
        raise AssertionError("PDF timing probe failed; inspect stage evidence (no retry)")
    print("Synthetic PDF probes passed with original validation/extraction deadlines.")


def summary():
    lines = ["## Linux verification evidence", "",
             "Results below are available measurements, not an automatic overall verdict.", ""]
    for name in ("backend", "frontend"):
        path = OUT / (name + ".xml")
        if not path.exists():
            lines.append(f"- {name}: no JUnit result; inspect failed or skipped workflow steps.")
            continue
        tree = ET.parse(path).getroot()
        suites = [tree] if tree.tag == "testsuite" else list(tree.findall("testsuite"))
        totals = {key: sum(float(s.get(key, "0")) for s in suites)
                  for key in ("tests", "failures", "errors", "skipped", "time")}
        totals["passed"] = totals["tests"] - totals["failures"] - totals["errors"] - totals["skipped"]
        failures = [{"class": case.get("classname"), "test": case.get("name"),
                     "seconds": case.get("time"), "kind": child.tag}
                    for case in tree.iter("testcase") for child in case
                    if child.tag in {"failure", "error"}]
        save(name + "-summary.json", {"totals": totals, "failures": failures})
        lines.append(f"- {name}: {json.dumps(totals, sort_keys=True)}")
    stages_file = OUT / "backend-test-stages.json"
    if stages_file.exists():
        failed_ids = sorted({entry["test"] for entry in json.loads(stages_file.read_text())
                             if entry["outcome"] == "failed"})
        lines.extend(f"- Failed backend ID: `{nodeid}`" for nodeid in failed_ids)
    warning_file = OUT / "backend-run.json"
    if warning_file.exists():
        run = json.loads(warning_file.read_text())
        lines.append(f"- Backend warnings: {len(run['warnings'])}; wall time: {run['elapsed_seconds']:.3f} s.")
    lines.extend(["", "PDF timing is in pdf-timing.json; native per-test worker observations are in backend-workers.json.",
                  "Windows historical combined: spawn to first Python .049567/.134682/3.710589 s;",
                  "completed pypdf import .241435/.698067/2.734728 s; validator total .339670/.998893/6.051776 s (min/median/max).",
                  "Different host/load and traced-bootstrap overhead prevent a controlled OS comparison.",
                  "A Linux pass does not establish that Windows timeouts are fixed."])
    text = "\n".join(lines) + "\n"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "summary.md").write_text(text, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(text)
    print(text)


if __name__ == "__main__":
    commands = {"versions": versions, "backend": backend, "smoke": smoke, "pdf": pdf, "summary": summary}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit("Usage: linux_verify.py versions|backend|smoke|pdf|summary")
    raise SystemExit(commands[sys.argv[1]]() or 0)
