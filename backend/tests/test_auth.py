"""Synthetic credentials, disposable SQLite and mocked AI; no external services."""

from io import BytesIO
import time

import pymupdf
import pytest

from app import create_app
from app.extensions import db


@pytest.fixture()
def app(demo_auth_config, tmp_path):
    application = create_app({
        **{key: value for key, value in demo_auth_config.items() if key != "_TEST_PASSWORD"},
        "DOCUMENT_UPLOAD_DIR": str(tmp_path / "private_uploads"),
    })
    with application.app_context():
        assert db.engine.url.drivername == "sqlite" and db.engine.url.database == ":memory:"
        db.create_all()
        yield application
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


def bootstrap(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    return {"X-CSRF-Token": response.json["csrf_token"]}


def sign_in(client, config, **changes):
    headers = bootstrap(client)
    return client.post("/api/auth/login", json={
        "username": config["DEMO_USERNAME"], "password": config["_TEST_PASSWORD"], **changes,
    }, headers=headers)


def test_login_rotates_anonymous_session_and_returns_only_safe_metadata(client, demo_auth_config):
    old = bootstrap(client)["X-CSRF-Token"]
    with client.session_transaction(path="/api") as state:
        state["unrelated"] = "old-state"
    response = client.post("/api/auth/login", json={"username": demo_auth_config["DEMO_USERNAME"],
        "password": demo_auth_config["_TEST_PASSWORD"]}, headers={"X-CSRF-Token": old})
    assert response.status_code == 200
    assert response.json["user"] == {"id": "demo", "display_name": "Demo User"}
    assert set(response.json) == {"user", "csrf_token", "expires_at"}
    assert response.json["csrf_token"] != old
    assert 28790 < response.json["expires_at"] - time.time() <= 28800
    with client.session_transaction(path="/api") as state:
        assert "unrelated" not in state and state.permanent
    assert client.get("/api/auth/me").json == response.json
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("changes", [{"username": "other-fictional-account"}, {"password": "synthetic-wrong-password"}])
def test_invalid_credentials_are_generic(client, demo_auth_config, changes):
    response = sign_in(client, demo_auth_config, **changes)
    assert response.status_code == 401
    assert response.json == {"error": "Invalid username or password.", "code": "auth_invalid_credentials"}
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("values", [None, [], {}, {"username": "demo"}, {"username": 7, "password": "x"},
    {"username": "x", "password": False}, {"username": " " , "password": "x"},
    {"username": "x" * 101, "password": "x"}, {"username": "x", "password": "x" * 1025},
    {"username": "x", "password": "x\0"}, {"username": "x\n", "password": "x"},
    {"username": "x", "password": "x", "extra": "x"}])
def test_malformed_login_is_safe(client, values):
    response = client.post("/api/auth/login", json=values, headers=bootstrap(client))
    assert response.status_code == 400 and response.json["error"] == "Invalid input."


def test_invalid_json_and_oversize_login(client):
    headers = bootstrap(client)
    for content in ("{invalid", '{"padding":"' + "x" * 17000 + '"}'):
        response = client.post("/api/auth/login", data=content, content_type="application/json", headers=headers)
        assert response.status_code == 400


@pytest.mark.parametrize("key,value", [("SECRET_KEY", None), ("SECRET_KEY", "short"),
    ("SECRET_KEY", "YOUR_SECRET_KEY_" * 3), ("DEMO_USERNAME", ""), ("DEMO_PASSWORD_HASH", ""),
    ("DEMO_PASSWORD_HASH", "plaintext"), ("DEMO_PASSWORD_HASH", "pbkdf2:sha256:1$salt$abc"),
    ("DEMO_PASSWORD_HASH", "scrypt:999999999:8:1$salt$abc")])
def test_missing_or_invalid_configuration_fails_closed(app, client, key, value):
    app.config[key] = value
    for method, path in [("get", "/api/auth/me"), ("post", "/api/auth/login"), ("get", "/api/dashboard/summary")]:
        response = getattr(client, method)(path)
        assert response.status_code == 503
        assert response.json == {"error": "Demo authentication is unavailable.", "code": "auth_unavailable"}
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize("method,path", [("get", "/api/dashboard/summary"), ("get", "/api/requests"),
    ("post", "/api/requests"), ("get", "/api/documents"), ("get", "/api/documents/1"),
    ("get", "/api/documents/search?q=fictional"), ("post", "/api/documents"),
    ("delete", "/api/documents/1"), ("post", "/api/ai/ask"), ("post", "/api/auth/logout")])
def test_private_operations_reject_guests_even_in_testing(client, method, path):
    response = getattr(client, method)(path)
    assert response.status_code == 401 and response.json["code"] == "auth_required"


@pytest.mark.parametrize("token", [None, "invalid"])
@pytest.mark.parametrize("method,path", [("post", "/api/requests"), ("patch", "/api/requests/1"),
    ("delete", "/api/requests/1"), ("post", "/api/documents"), ("delete", "/api/documents/1"),
    ("post", "/api/ai/ask"), ("post", "/api/auth/logout")])
def test_all_mutations_enforce_csrf(client, demo_auth_config, token, method, path):
    assert sign_in(client, demo_auth_config).status_code == 200
    response = getattr(client, method)(path, headers={} if token is None else {"X-CSRF-Token": token})
    assert response.status_code == 403 and response.json["code"] == "auth_csrf_failed"
    assert client.get("/api/auth/me").status_code == 200  # 403 is not session expiry.


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://localhost.evil.example"])
def test_login_origin_checks_with_correct_token(client, demo_auth_config, origin):
    headers = {**bootstrap(client), "Origin": origin}
    result = client.post("/api/auth/login", json={"username": demo_auth_config["DEMO_USERNAME"],
        "password": demo_auth_config["_TEST_PASSWORD"]}, headers=headers)
    assert result.status_code == 403


def test_login_requires_csrf_and_rejects_cross_site_fetch(client, demo_auth_config):
    data = {"username": demo_auth_config["DEMO_USERNAME"], "password": demo_auth_config["_TEST_PASSWORD"]}
    assert client.post("/api/auth/login", json=data).status_code == 403
    assert client.post("/api/auth/login", json=data, headers={**bootstrap(client), "Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_valid_origin_and_authenticated_operations(client, demo_auth_config, monkeypatch):
    headers = {**bootstrap(client), "Origin": "http://localhost"}
    login = client.post("/api/auth/login", json={"username": demo_auth_config["DEMO_USERNAME"],
        "password": demo_auth_config["_TEST_PASSWORD"]}, headers=headers)
    headers["X-CSRF-Token"] = login.json["csrf_token"]
    assert client.get("/api/dashboard/summary").status_code == 200
    created = client.post("/api/requests", json={"title": "Fictional support", "description": "Synthetic details", "category": "GENERAL"}, headers=headers)
    assert created.status_code == 201
    assert client.get("/api/requests").json["total"] == 1
    assert client.patch(f'/api/requests/{created.json["data"]["id"]}', json={"status": "RESOLVED"}, headers=headers).status_code == 200
    assert client.get("/api/documents").status_code == 200
    monkeypatch.setattr("app.routes.ai.ask_question", lambda question, config: {"answer": "Fictional answer", "sources": [], "grounded": False})
    response = client.post("/api/ai/ask", json={"question": "Fictional policy?"}, headers=headers)
    assert response.status_code == 200 and set(response.json) == {"answer", "sources", "grounded"}


def test_authenticated_pdf_upload_preserves_processing_and_validation(client, demo_auth_config):
    headers = {"X-CSRF-Token": sign_in(client, demo_auth_config).json["csrf_token"]}
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), "Fictional support policy. Submit a synthetic claim form.")
        content = pdf.tobytes()
    result = client.post("/api/documents", data={"file": (BytesIO(content), "fictional.pdf"), "title": "Fictional policy"}, headers=headers)
    assert result.status_code == 201, result.json
    assert result.json["data"]["processing_status"] == "INDEXED"
    document_id = result.json["data"]["id"]
    assert client.get(f"/api/documents/{document_id}").status_code == 200
    invalid = client.post("/api/documents", data={"file": (BytesIO(b"invalid"), "fictional.pdf")}, headers=headers)
    assert invalid.status_code == 400 and "file" in invalid.json["details"]
    assert client.delete(f"/api/documents/{document_id}", headers=headers).status_code == 204
    assert client.get(f"/api/documents/{document_id}").status_code == 404


def test_logout_clears_cookie_and_protected_access(client, demo_auth_config):
    headers = {"X-CSRF-Token": sign_in(client, demo_auth_config).json["csrf_token"]}
    result = client.post("/api/auth/logout", headers=headers)
    assert result.status_code == 200
    assert "Max-Age=0" in result.headers["Set-Cookie"]
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/dashboard/summary").status_code == 401


def test_absolute_expiration_and_credential_rotation(client, demo_auth_config, app):
    sign_in(client, demo_auth_config)
    with client.session_transaction(path="/api") as state:
        state["expires_at"] = time.time() - 1
    assert client.get("/api/dashboard/summary").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    sign_in(client, demo_auth_config)
    app.config["DEMO_USERNAME"] = "different-fictional-user"
    assert client.get("/api/auth/me").status_code == 401


def test_cookie_signature_and_serializer_lifetime(client, app, demo_auth_config, monkeypatch):
    from flask.sessions import SecureCookieSessionInterface
    sign_in(client, demo_auth_config)
    cookie = client.get_cookie(app.config["SESSION_COOKIE_NAME"], path="/api")
    client.set_cookie(cookie.key, cookie.value + "tampered", path="/api")
    assert client.get("/api/auth/me").status_code == 401
    sign_in(client, demo_auth_config)
    serializer = SecureCookieSessionInterface().get_signing_serializer(app)
    original = serializer.loads
    def loads(value, max_age):
        assert max_age == 28800
        from itsdangerous import SignatureExpired
        raise SignatureExpired("Synthetic expired signature")
    monkeypatch.setattr(serializer, "loads", loads)
    monkeypatch.setattr(app.session_interface, "get_signing_serializer", lambda app: serializer)
    assert client.get("/api/auth/me").status_code == 401
    monkeypatch.setattr(serializer, "loads", original)


def test_cookie_controls_and_non_sliding_session(client, app, demo_auth_config):
    app.config["SESSION_COOKIE_SECURE"] = True
    result = client.get("/api/auth/me", base_url="https://localhost")
    cookie = result.headers["Set-Cookie"]
    assert all(value in cookie for value in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/api"))
    response = client.post("/api/auth/login", base_url="https://localhost", json={
        "username": demo_auth_config["DEMO_USERNAME"], "password": demo_auth_config["_TEST_PASSWORD"]},
        headers={"X-CSRF-Token": result.json["csrf_token"], "Origin": "https://localhost"})
    assert response.status_code == 200
    assert "Expires=" in response.headers["Set-Cookie"]
    assert "Set-Cookie" not in client.get("/api/auth/me", base_url="https://localhost").headers


def test_no_secret_leakage(client, demo_auth_config, caplog):
    result = sign_in(client, demo_auth_config)
    combined = result.get_data(as_text=True) + str(result.headers) + caplog.text
    for key in ("SECRET_KEY", "DEMO_PASSWORD_HASH", "_TEST_PASSWORD"):
        assert demo_auth_config[key] not in combined
    with client.session_transaction(path="/api") as state:
        assert "password" not in str(dict(state)).lower()
