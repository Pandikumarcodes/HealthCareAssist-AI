from app import create_app
import pytest


@pytest.mark.parametrize("setting,value", [("PUBLIC_HOST", ""), ("SESSION_COOKIE_SECURE", "false"), ("DATABASE_URL", "postgresql://test@localhost/test?sslmode=disable")])
def test_production_rejects_unsafe_configuration(monkeypatch, setting, value):
    from app.config import local_configuration
    monkeypatch.setenv("RENDER_DEPLOYMENT", "true")
    monkeypatch.setenv("PUBLIC_HOST", "example.com")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql://test@localhost/test?sslmode=require")
    monkeypatch.setenv(setting, value)
    with pytest.raises(RuntimeError):
        local_configuration()


def test_static_spa_and_api_boundaries(tmp_path):
    (tmp_path / "index.html").write_text("SPA", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("asset", encoding="utf-8")
    app = create_app({"SERVE_FRONTEND": True, "FRONTEND_DIST": str(tmp_path)})
    client = app.test_client()
    assert client.get("/").data == b"SPA"
    assert client.get("/requests/123").data == b"SPA"
    assert client.get("/assets/app.js").data == b"asset"
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/api/missing").status_code == 404
    assert client.get("/api/health").get_json()["status"] == "healthy"
    assert client.post("/api/auth/login", json={}).status_code == 503


def test_render_scheme_and_host_ignore_forwarded_headers():
    app = create_app({"RENDER_DEPLOYMENT": True, "TRUSTED_HOSTS": ["example.com"]})
    client = app.test_client()
    assert client.get("/api/health", base_url="http://example.com", headers={
        "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "http",
    }).status_code == 200
    assert client.get("/api/health", base_url="http://attacker.example", headers={
        "X-Forwarded-Host": "example.com", "X-Forwarded-Proto": "https",
    }).status_code == 400


def test_built_frontend_and_https_csrf(demo_auth_config):
    from pathlib import Path
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if not (dist / "index.html").is_file():
        pytest.skip("Build the frontend to run the compiled-asset integration check.")
    settings = {key: value for key, value in demo_auth_config.items() if key != "_TEST_PASSWORD"}
    app = create_app({**settings, "RENDER_DEPLOYMENT": True, "SERVE_FRONTEND": True,
                      "SESSION_COOKIE_SECURE": True, "TRUSTED_HOSTS": ["example.com"]})
    client = app.test_client()
    assert client.get("/knowledge-base", base_url="https://example.com").data == (dist / "index.html").read_bytes()
    for asset in (dist / "assets").iterdir():
        assert client.get("/assets/" + asset.name, base_url="https://example.com").data == asset.read_bytes()
    guest = client.get("/api/auth/me", base_url="https://example.com")
    assert "Secure" in guest.headers["Set-Cookie"]
    payload = {"username": settings["DEMO_USERNAME"], "password": demo_auth_config["_TEST_PASSWORD"]}
    headers = {"Origin": "https://example.com", "X-CSRF-Token": guest.get_json()["csrf_token"],
               "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http"}
    response = client.post("/api/auth/login", base_url="https://example.com", json=payload, headers=headers)
    assert response.status_code == 200
    headers["X-CSRF-Token"] = response.get_json()["csrf_token"]
    headers["Origin"] = "https://evil.example"
    assert client.post("/api/auth/logout", base_url="https://example.com", headers=headers).status_code == 403
    headers["Origin"] = "https://example.com"
    assert client.post("/api/auth/logout", base_url="https://example.com", headers=headers).status_code == 200
