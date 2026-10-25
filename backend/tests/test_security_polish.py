"""Step 6.2 regressions; ephemeral credentials, no database or provider calls."""
import pytest

from app import create_app


@pytest.fixture()
def client(demo_auth_config):
    app = create_app({key: value for key, value in demo_auth_config.items() if key != "_TEST_PASSWORD"})
    return app.test_client()


def bootstrap(client):
    return {"X-CSRF-Token": client.get("/api/auth/me").json["csrf_token"]}


@pytest.mark.parametrize("field", ["username", "password"])
@pytest.mark.parametrize("invalid", ["\ud800", "\udfff"])
def test_login_rejects_malformed_unicode(client, field, invalid):
    payload = {"username": "fictional-reviewer", "password": "synthetic-input", field: invalid}
    result = client.post("/api/auth/login", json=payload, headers=bootstrap(client))
    assert result.status_code == 400
    assert result.json == {"error": "Invalid input.", "code": "auth_invalid_input"}


def test_login_rejects_deep_json_without_exception_details(client):
    result = client.post("/api/auth/login", data="[" * 1100 + "0" + "]" * 1100,
                         content_type="application/json", headers=bootstrap(client))
    assert result.status_code == 400
    assert result.json == {"error": "Invalid input.", "code": "auth_invalid_input"}


@pytest.mark.parametrize("path", ["/api/health", "/api/auth/me", "/api/documents/1", "/api/missing"])
def test_api_headers_cover_public_private_and_errors(client, path):
    result = client.get(path)
    assert result.headers["X-Content-Type-Options"] == "nosniff"
    assert result.headers["Referrer-Policy"] == "same-origin"
    assert "Access-Control-Allow-Origin" not in result.headers
    assert "Access-Control-Allow-Credentials" not in result.headers


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/problem+json"])
def test_alternate_content_types_cannot_bypass_csrf(client, demo_auth_config, content_type):
    signed_in = client.post("/api/auth/login", json={"username": demo_auth_config["DEMO_USERNAME"],
        "password": demo_auth_config["_TEST_PASSWORD"]}, headers=bootstrap(client))
    assert signed_in.status_code == 200
    for path in ("/api/requests", "/api/documents", "/api/ai/ask", "/api/auth/logout"):
        result = client.post(path, data="", content_type=content_type)
        assert result.status_code == 403 and result.json["code"] == "auth_csrf_failed"
