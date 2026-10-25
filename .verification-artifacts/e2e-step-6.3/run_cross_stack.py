"""Opt-in local integration runner. Creates and removes ONLY its new DB/role.

Requires explicit --provision-disposable-postgres approval. All credentials stay
in memory. No application configuration is changed and no live AI is possible.
"""
import argparse
from contextlib import contextmanager
import io
import json
from pathlib import Path
import secrets
from shutil import copyfile
import socket
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
prior_report = OUT / "cross-stack-report.json"
if prior_report.is_file() and "within the time limit" in prior_report.read_text(encoding="utf-8"):
    for source, destination in (("cross-stack-report.json", "pdf-timeout-integration.json"), ("integrated-browser-report.json", "pdf-timeout-browser.json")):
        if not (OUT / destination).exists():
            copyfile(OUT / source, OUT / destination)
sys.path.insert(0, str(ROOT / "backend"))
from app import create_app, gemini
from app.config import local_configuration
from app.extensions import db
from flask_migrate import upgrade
from google.genai import errors, types
import httpx
import psycopg
from psycopg import sql
import pymupdf
from sqlalchemy import event, text
from sqlalchemy.engine import Engine, make_url, URL
from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server, WSGIRequestHandler

REPORT = {"checks": [], "latencies_ms": [], "provider_calls": [], "blocked_network": [], "live_gemini_calls": 0}
MODE = "success"
POLICY = "Demo Clinic appointment cancellation policy: Appointments can be cancelled 24 hours before the scheduled time."


def network_guard(event_name, args):
    if event_name == "socket.connect":
        address = args[1]
        if isinstance(address, tuple) and address[0] not in {"localhost", "127.0.0.1", "::1"}:
            REPORT["blocked_network"].append("non-loopback connection denied")
            raise RuntimeError("Integration runner forbids non-loopback network connections")


class FakeClient:
    def __init__(self, **kwargs):
        assert kwargs["vertexai"] is False
        assert kwargs["api_key"] == "fictional-offline-key"
        assert kwargs["http_options"].retry_options.attempts == 1
        self.models = self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def generate_content(self, *, model, contents, config):
        assert model == "gemini-3.5-flash-lite"
        values = json.loads(contents)
        passages = values["passages"]
        assert 1 <= len(passages) <= 5 and all(len(p["text"]) <= 1200 for p in passages)
        assert all(p["page_number"] == 1 and POLICY in p["text"] for p in passages)
        REPORT["provider_calls"].append({"mode": MODE, "passages": passages, "question": values["question"]})
        if MODE == "timeout":
            raise TimeoutError("PRIVATE provider diagnostic")
        if MODE in {"quota", "credentials", "unavailable"}:
            raise errors.APIError({"quota": 429, "credentials": 403, "unavailable": 503}[MODE], {"message": "PRIVATE provider diagnostic"})
        if MODE == "invalid":
            raw = "invalid JSON"
        elif MODE == "invented":
            raw = json.dumps({"supported": True, "excerpts": [{"chunk_id": passages[0]["chunk_id"], "quote": "Invented policy."}]})
        else:
            raw = json.dumps({"supported": True, "excerpts": [{"chunk_id": passages[0]["chunk_id"], "quote": POLICY}]})
        return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(parts=[types.Part(text=raw)]), finish_reason=types.FinishReason.STOP)])


class QuietHandler(WSGIRequestHandler):
    def log(self, *args, **kwargs):
        pass


def check(name):
    REPORT["checks"].append({"name": name, "status": "PASS", "level": "HTTP Flask + isolated PostgreSQL (SDK mocked)"})


def api_checks(app, password, pdf, storage):
    global MODE
    with httpx.Client(base_url="http://127.0.0.1:5053", timeout=30) as client:
        def call(method, path, expected=200, **kwargs):
            start = time.perf_counter()
            response = client.request(method, "/api" + path, **kwargs)
            REPORT["latencies_ms"].append({"method": method, "path": path.split("?")[0], "status": response.status_code, "ms": round((time.perf_counter()-start)*1000, 2)})
            assert response.status_code == expected, f"{method} {path}: expected {expected}, got {response.status_code}"
            assert response.headers.get("cache-control") == "no-store"
            assert "PRIVATE" not in response.text
            return response

        call("GET", "/requests", 401)
        token = call("GET", "/auth/me", 401).json()["csrf_token"]
        call("POST", "/auth/login", 403, json={"username": "fictional-reviewer", "password": password})
        client.headers["X-CSRF-Token"] = token
        call("POST", "/auth/login", 401, json={"username": "fictional-reviewer", "password": "invalid-fictional"})
        response = call("POST", "/auth/login", json={"username": "fictional-reviewer", "password": password})
        client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/api" in cookie and "Domain=" not in cookie
        assert response.json()["csrf_token"] != token
        check("real login, generic invalid credentials, token rotation, cookie attributes")
        assert call("GET", "/auth/me").json()["user"]["id"] == "demo"
        check("session restoration over HTTP")
        counts = call("GET", "/dashboard/summary").json()
        assert all(v == 0 for v in counts.values())
        check("empty dashboard")
        for bad in ("", "invalid-token"):
            call("POST", "/requests", 403, headers={"X-CSRF-Token": bad}, json={})
        call("POST", "/requests", 403, headers={"Origin": "https://invalid.example"}, json={})
        check("missing/invalid CSRF and cross-origin rejection")
        call("POST", "/requests", 400, json={"title": "", "description": "", "category": "invalid"})
        check("support validation")
        ids = []
        for index, status in enumerate(("OPEN", "IN_PROGRESS", "RESOLVED")):
            item = call("POST", "/requests", 201, json={"title": f"Fictional cancellation {index}", "description": "Synthetic appointment support.", "category": "APPOINTMENT"}).json()["data"]
            ids.append(item["id"])
            if status != "OPEN":
                call("PATCH", f"/requests/{item['id']}", json={"status": status})
        assert call("GET", "/dashboard/summary").json() == {"total_requests": len(ids), "open_requests": 1, "in_progress_requests": 1, "resolved_requests": 1}
        check("create/read/status persistence and dashboard fixture-derived counts")
        call("PATCH", f"/requests/{ids[0]}", json={"title": "Fictional revised cancellation"})
        assert call("GET", f"/requests/{ids[0]}").json()["data"]["title"] == "Fictional revised cancellation"
        from sqlalchemy.exc import OperationalError
        with patch.object(db.session, "commit", side_effect=OperationalError("", {}, Exception("PRIVATE"))):
            call("PATCH", f"/requests/{ids[0]}", 500, json={"title": "Fictional unsaved edit"})
        assert call("GET", f"/requests/{ids[0]}").json()["data"]["title"] == "Fictional revised cancellation"
        with patch.object(db.session, "commit", side_effect=OperationalError("", {}, Exception("PRIVATE"))):
            call("DELETE", f"/requests/{ids[0]}", 500)
        call("GET", f"/requests/{ids[0]}")
        check("failed update/delete transaction rollback and subsequent recovery")
        assert call("GET", "/requests?q=revised&status=OPEN&category=APPOINTMENT").json()["total"] == 1
        assert len(call("GET", "/requests?page=2&page_size=2").json()["data"]) == 1
        assert call("GET", "/requests?q=%25").json()["total"] == 0
        check("request edit, literal search, filters and pagination on PostgreSQL")
        for request_id in ids:
            call("DELETE", f"/requests/{request_id}", 204)
            call("GET", f"/requests/{request_id}", 404)
        check("request deletion persisted")
        for filename, content, expected in (("invalid.txt", b"text", 400), ("empty.pdf", b"", 400), ("corrupt.pdf", b"%PDF-1.7\ncorrupted\n%%EOF", 400), ("large.pdf", b"x" * (5242880+1), 413), ("../traversal.pdf", pdf, 400)):
            call("POST", "/documents", expected, files={"file": (filename, content, "application/pdf")})
        check("invalid, empty, corrupt, oversized and traversal PDF rejection")
        call("POST", "/documents", 403, headers={"X-CSRF-Token": "invalid"}, files={"file": ("synthetic.pdf", pdf, "application/pdf")})
        check("multipart CSRF enforcement")
        doc = call("POST", "/documents", 201, files={"file": ("synthetic.pdf", pdf, "application/pdf")}, data={"title": "Fictional Cancellation Policy"}).json()["data"]
        assert doc["processing_status"] == "INDEXED" and doc["file_size"] == len(pdf)
        assert call("GET", f"/documents/{doc['id']}").json()["data"] == doc
        check("real PDF validation/extraction workers, indexed metadata and details")
        matches = call("GET", "/documents/search?q=cancellation").json()["results"]
        assert matches and all(m["document_id"] == doc["id"] and m["page_number"] == 1 and POLICY in m["text"] for m in matches)
        assert call("GET", "/documents/search?q=unfindablezebra").json()["results"] == []
        call("GET", "/documents/invalid", 404)
        check("actual PostgreSQL full-text retrieval, page/chunk provenance, no matches and invalid ID")
        grounded = call("POST", "/ai/ask", json={"question": "cancellation"}).json()
        assert grounded["grounded"] and grounded["sources"][0]["document_id"] == doc["id"]
        assert grounded["sources"][0]["chunk_id"] in {m["chunk_id"] for m in matches}
        assert grounded["sources"][0]["page_number"] == 1 and POLICY in grounded["answer"]
        check("HTTP AI through PostgreSQL retrieval, bounded SDK mock, validated quotes/citations")
        calls_before = len(REPORT["provider_calls"])
        assert call("POST", "/ai/ask", json={"question": "unfindablezebra"}).json() == gemini.no_information()
        assert len(REPORT["provider_calls"]) == calls_before
        check("AI no-context skips provider")
        for value in ("", "\U0001f600" * 1001):
            call("POST", "/ai/ask", 400, json={"question": value})
        check("empty and 1001 Unicode code-point question rejection")
        for mode, status, code in (("invalid", 502, "ai_invalid_response"), ("quota", 429, "ai_rate_limited"), ("credentials", 503, "ai_credentials_rejected"), ("timeout", 504, "ai_timeout"), ("unavailable", 503, "ai_unavailable")):
            MODE = mode
            assert call("POST", "/ai/ask", status, json={"question": "cancellation"}).json()["code"] == code
            check("sanitized mocked provider " + mode)
        MODE = "invented"
        assert call("POST", "/ai/ask", json={"question": "cancellation"}).json() == gemini.no_information()
        MODE = "success"
        check("fabricated evidence rejected")
        call("DELETE", f"/documents/{doc['id']}", 204)
        with app.app_context():
            assert db.session.scalar(text("SELECT count(*) FROM document_chunks")) == 0
            assert db.session.scalar(text("SELECT count(*) FROM documents")) == 0
        assert not list(storage.glob("*.pdf"))
        assert call("GET", "/documents/search?q=cancellation").json()["results"] == []
        check("document deletion removes chunks, search entries and private PDF")
        with patch("app.document_processing.extract_chunks", side_effect=OSError("PRIVATE controlled extraction failure")):
            failed_doc = call("POST", "/documents", 201, files={"file": ("synthetic.pdf", pdf, "application/pdf")}).json()["data"]
        assert failed_doc["processing_status"] == "FAILED"
        retry = app.test_cli_runner().invoke(args=["process-document", str(failed_doc["id"])])
        assert retry.exit_code == 0
        assert call("GET", f"/documents/{failed_doc['id']}").json()["data"]["processing_status"] == "INDEXED"
        call("DELETE", f"/documents/{failed_doc['id']}", 204)
        check("controlled PDF processing failure and existing CLI retry lifecycle")
        # Controlled DB failure at this app's query boundary; shared service untouched.
        with patch("app.routes.dashboard.get_dashboard_summary", side_effect=OperationalError("", {}, Exception("PRIVATE"))):
            call("GET", "/dashboard/summary", 503)
        call("GET", "/dashboard/summary")
        check("sanitized database failure and recovery")
        call("POST", "/auth/logout")
        call("GET", "/requests", 401)
        call("POST", "/documents", 401, files={"file": ("synthetic.pdf", pdf, "application/pdf")})
        check("logout invalidates current cookie and unauthenticated upload/API")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provision-disposable-postgres", action="store_true", required=True)
    parser.add_argument("--skip-mocked-browser", action="store_true", help="Diagnostic reruns only; final run includes both harnesses")
    args = parser.parse_args()
    sys.addaudithook(network_guard)
    for port in (5053, 5186):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    application_url = make_url(local_configuration()["SQLALCHEMY_DATABASE_URI"])
    assert application_url.host in {"localhost", "127.0.0.1"} and application_url.port == 7498
    name = "hca_e2e_63_" + secrets.token_hex(6)
    role = name + "_role"
    role_password, login_password = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    admin_options = dict(host=application_url.host, port=application_url.port, dbname="postgres", user=application_url.username, password=application_url.password, connect_timeout=5)
    created_role = created_db = False
    server = vite = engine = None
    oid = None
    try:
        with psycopg.connect(**admin_options, autocommit=True) as admin:
            assert not admin.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone()
            assert not admin.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone()
            admin.execute(sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD {}").format(sql.Identifier(role), sql.Literal(role_password)))
            created_role = True
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(sql.Identifier(name), sql.Identifier(role)))
            created_db = True
            admin.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(name)))
            oid = admin.execute("SELECT oid FROM pg_database WHERE datname=%s AND pg_get_userbyid(datdba)=%s", (name, role)).fetchone()[0]
        test_url = URL.create("postgresql+psycopg", username=role, password=role_password, host="localhost", port=7498, database=name)

        def db_guard(dialect, record, args, params):
            assert dialect.name == "postgresql" and params.get("dbname") == name and params.get("user") == role and int(params.get("port")) == 7498

        event.listen(Engine, "do_connect", db_guard)
        with tempfile.TemporaryDirectory(prefix="hca-63-", dir=OUT) as temp:
            temp = Path(temp)
            storage = temp / "private-pdfs"
            pdf_document = pymupdf.open()
            page = pdf_document.new_page()
            page.insert_textbox(pymupdf.Rect(40, 40, 550, 200), POLICY, fontsize=12)
            pdf = pdf_document.tobytes()
            pdf_document.close()
            (OUT / "synthetic-policy.pdf").write_bytes(pdf)
            app = create_app({"TESTING": False, "SQLALCHEMY_DATABASE_URI": test_url,
                "SECRET_KEY": secrets.token_hex(32), "DEMO_USERNAME": "fictional-reviewer",
                "DEMO_PASSWORD_HASH": generate_password_hash(login_password), "SESSION_COOKIE_SECURE": False,
                "DOCUMENT_UPLOAD_DIR": str(storage), "GEMINI_API_KEY": "fictional-offline-key"})
            from flask import request
            @app.after_request
            def record_document_validation(response):
                if request.path == "/api/documents" and request.method == "POST" and response.status_code == 400:
                    REPORT.setdefault("document_validation_failures", []).append(response.get_json())
                return response
            with patch.object(gemini.genai, "Client", FakeClient):
                with app.app_context():
                    engine = db.engine
                    upgrade(directory=str(ROOT / "backend/migrations"))
                    identity = db.session.execute(text("SELECT current_database() AS database, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS createdb, (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS createrole")).mappings().one()
                    assert identity["database"] == name and not any(identity[k] for k in ("superuser", "createdb", "createrole"))
                    assert db.session.scalar(text("SELECT version_num FROM alembic_version")) == "9d82b6f31a04"
                    assert "gin" in db.session.scalar(text("SELECT indexdef FROM pg_indexes WHERE indexname='ix_document_chunks_search'"))
                    REPORT["isolation"] = {**dict(identity), "role": role, "database_oid": oid, "migrations_head": "9d82b6f31a04", "gin_index": True, "new_resources_only": True}
                server = make_server("127.0.0.1", 5053, app, threaded=True, request_handler=QuietHandler)
                threading.Thread(target=server.serve_forever, daemon=True).start()
                api_checks(app, login_password, pdf, storage)
                vite_log = (OUT / "vite.log").open("w", encoding="utf-8")
                vite = subprocess.Popen(["node", str(ROOT / "frontend/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5186", "--strictPort"], cwd=ROOT / "frontend", stdout=vite_log, stderr=subprocess.STDOUT)
                for _ in range(100):
                    try:
                        if httpx.get("http://127.0.0.1:5186", timeout=1).status_code == 200:
                            break
                    except httpx.HTTPError:
                        time.sleep(.1)
                # Regression: Vite string shorthand rewrites Host and caused 403
                # for same-origin browser POSTs. Preserve strict Origin checks.
                with httpx.Client(base_url="http://127.0.0.1:5186", timeout=10) as proxy_client:
                    token = proxy_client.get("/api/auth/me").json()["csrf_token"]
                    headers = {"Origin": "http://127.0.0.1:5186", "X-CSRF-Token": token}
                    invalid = proxy_client.post("/api/auth/login", headers=headers, json={"username": "fictional-reviewer", "password": "invalid-fictional"})
                    assert invalid.status_code == 401, "same-origin Vite login must reach credential verification"
                    rejected = proxy_client.post("/api/auth/login", headers={**headers, "Origin": "https://invalid.example"}, json={"username": "fictional-reviewer", "password": login_password})
                    assert rejected.status_code == 403
                    accepted = proxy_client.post("/api/auth/login", headers=headers, json={"username": "fictional-reviewer", "password": login_password})
                    assert accepted.status_code == 200
                check("Vite proxy: same-origin invalid login 401, cross-origin 403, valid login 200")
                # Reuse original mocked harness without overwriting prior evidence or duplicating screenshots.
                source = (ROOT / ".verification-artifacts/security-step-6.2/browser-check.mjs").read_text(encoding="utf-8")
                source = source.replace("'browser-report.json'", "'mocked-browser-report.json'")
                source = source.replace("async function screenshot(name) {", "async function screenshot(name) { return; /* screenshots already retained in Step 6.2 */")
                (OUT / "mocked-browser.mjs").write_text(source, encoding="utf-8")
                if not args.skip_mocked_browser:
                    result = subprocess.run(["node", str(OUT / "mocked-browser.mjs")], cwd=ROOT, capture_output=True, text=True, timeout=300)
                    (OUT / "mocked-browser.log").write_text(result.stdout + result.stderr, encoding="utf-8")
                    assert result.returncode == 0, "Mocked browser run failed; see secret-free log"
                from app.auth import credential_version
                with app.app_context():
                    expired_cookie = app.session_interface.get_signing_serializer(app).dumps({"user_id": "demo", "expires_at": time.time()-60, "credential_version": credential_version(), "csrf_token": secrets.token_urlsafe(32), "_permanent": True})
                browser = subprocess.run(["node", str(OUT / "integrated-browser.mjs")], input=json.dumps({"username": "fictional-reviewer", "password": login_password, "expiredCookie": expired_cookie}), cwd=ROOT, capture_output=True, text=True, timeout=300)
                # Never persist stdin or full error diagnostics from a credential-bearing process.
                REPORT["browser_exit_code"] = browser.returncode
                assert browser.returncode == 0, "Integrated browser failed; see integrated-browser-report.json"
                with app.app_context():
                    assert db.session.scalar(text("SELECT count(*) FROM support_requests")) == 0
                    assert db.session.scalar(text("SELECT count(*) FROM documents")) == 0
                    assert db.session.scalar(text("SELECT count(*) FROM document_chunks")) == 0
                assert not list(storage.glob("*.pdf"))
                check("browser-created records/chunks/files completely removed")
            vite_log.close()
        REPORT["verdict"] = "PASS"
    except Exception as error:
        REPORT["verdict"] = "FAIL"
        REPORT["failure_type"] = type(error).__name__
        # Assertions are developer-owned messages; never persist driver errors/URLs.
        if isinstance(error, AssertionError):
            REPORT["failure"] = str(error)
        raise
    finally:
        if server:
            server.shutdown()
            server.server_close()
        if vite:
            vite.terminate()
            vite.wait(timeout=10)
        if engine:
            engine.dispose()
        if created_role:
            with psycopg.connect(**admin_options, autocommit=True) as admin:
                if created_db:
                    actual = admin.execute("SELECT oid FROM pg_database WHERE datname=%s AND pg_get_userbyid(datdba)=%s", (name, role)).fetchone()
                    assert actual and (oid is None or actual[0] == oid) and name.startswith("hca_e2e_63_")
                    admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
                admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
                REPORT["cleanup"] = {"new_database_removed": not bool(admin.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone()), "new_role_removed": not bool(admin.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone())}
        (OUT / "cross-stack-report.json").write_text(json.dumps(REPORT, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
