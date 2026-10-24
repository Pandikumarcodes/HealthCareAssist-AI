"""Explicit real login fixtures, never a production TESTING authentication bypass."""

import secrets

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from werkzeug.security import generate_password_hash


@pytest.fixture(scope="session")
def demo_auth_config():
    # Ephemeral synthetic credentials; no .env access or shared default password.
    password = secrets.token_urlsafe(24)
    return {"SECRET_KEY": secrets.token_hex(32), "DEMO_USERNAME": "fictional-reviewer",
            "DEMO_PASSWORD_HASH": generate_password_hash(password),
            "SESSION_COOKIE_SECURE": False, "_TEST_PASSWORD": password}


@pytest.fixture()
def authenticated_client(demo_auth_config):
    def make_client(app):
        app.config.update({key: value for key, value in demo_auth_config.items() if key != "_TEST_PASSWORD"})
        client = app.test_client()
        token = client.get("/api/auth/me").get_json()["csrf_token"]
        response = client.post("/api/auth/login", json={
            "username": demo_auth_config["DEMO_USERNAME"], "password": demo_auth_config["_TEST_PASSWORD"],
        }, headers={"X-CSRF-Token": token})
        assert response.status_code == 200
        client.environ_base["HTTP_X_CSRF_TOKEN"] = response.get_json()["csrf_token"]
        return client
    return make_client


@pytest.fixture(autouse=True)
def isolated_databases_only():
    """Reject any real PostgreSQL connection before the DBAPI can open it."""
    def guard(dialect, connection_record, connection_args, connection_params):
        if dialect.name != "sqlite":
            pytest.fail("Backend tests may connect only to disposable SQLite databases.")
    event.listen(Engine, "do_connect", guard)
    yield
    event.remove(Engine, "do_connect", guard)
