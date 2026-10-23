from unittest.mock import MagicMock

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

from app import create_app
from app import config, database
from app.extensions import db, migrate


@pytest.fixture(autouse=True)
def isolate_separate_database_settings(monkeypatch):
    for name in ("DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"):
        monkeypatch.delenv(name, raising=False)


def test_separate_fields_preserve_literal_password(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    password = "test@pass:/?#% with spaces"
    for name, value in {
        "DB_HOST": "localhost", "DB_PORT": "7498", "DB_USER": "postgres",
        "DB_PASSWORD": password, "DB_NAME": "healthcareassist_ai",
    }.items():
        monkeypatch.setenv(name, value)
    app = create_app()
    with app.app_context():
        assert db.engine.url.password == password
        assert db.engine.url.host == "localhost"
        assert db.engine.url.port == 7498
        assert db.engine.url.database == "healthcareassist_ai"


def test_database_url_takes_precedence_over_separate_fields(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://url_role@localhost:7498/url_database")
    monkeypatch.setenv("DB_PORT", "invalid")
    app = create_app()
    with app.app_context():
        assert db.engine.url.username == "url_role"
        assert db.engine.url.database == "url_database"


@pytest.mark.parametrize("port", ["invalid", "0", "65536"])
def test_separate_fields_reject_invalid_port(monkeypatch, tmp_path, port):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for name, value in {
        "DB_HOST": "localhost", "DB_PORT": port, "DB_USER": "postgres",
        "DB_PASSWORD": "private", "DB_NAME": "healthcareassist_ai",
    }.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError, match="DB_PORT"):
        create_app()


@pytest.fixture()
def app():
    return create_app({"TESTING": True})


def test_factory_initializes_database_extensions(app):
    assert app.extensions["sqlalchemy"] is db
    assert app.extensions["migrate"].db is db
    assert app.extensions["migrate"].migrate is migrate
    assert app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] is False
    assert set(db.metadata.tables) == {"support_requests", "documents", "document_chunks"}


@pytest.mark.parametrize("scheme", ["postgresql", "postgres", "postgresql+psycopg"])
def test_factory_loads_database_url_at_creation(monkeypatch, tmp_path, scheme):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"{scheme}://test_role:test_password@127.0.0.1:7498/healthcareassist_ai")
    app = create_app()
    assert app.config["SQLALCHEMY_DATABASE_URI"] == (
        "postgresql+psycopg://test_role:test_password@127.0.0.1:7498/healthcareassist_ai"
    )
    assert app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] is False


def test_dotenv_is_loaded_without_overriding_environment(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql+psycopg://file_role@localhost:7498/healthcareassist_ai\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert "file_role@" in config.local_configuration()["SQLALCHEMY_DATABASE_URI"]
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://environment_role@localhost:7498/healthcareassist_ai")
    assert "environment_role@" in config.local_configuration()["SQLALCHEMY_DATABASE_URI"]


@pytest.mark.parametrize("url", ["", "sqlite:///unwanted.db"])
def test_missing_or_non_postgres_configuration_fails_clearly(monkeypatch, tmp_path, url):
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.setenv("DATABASE_URL", url)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        create_app()


def test_unit_test_configuration_ignores_local_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "invalid")
    app = create_app({"TESTING": True})
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"


def test_health_does_not_open_database_connection(monkeypatch):
    def forbidden_connection(*args, **kwargs):
        pytest.fail("Health endpoint attempted a database connection")

    monkeypatch.setattr(Engine, "connect", forbidden_connection)
    app = create_app({
        "SQLALCHEMY_DATABASE_URI": "postgresql+psycopg://test_role@127.0.0.1:1/healthcareassist_ai"
    })
    response = app.test_client().get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {
        "status": "healthy", "service": "HealthCareAssist AI", "version": "1.0.0"
    }


def test_database_verification_executes_select_one(app, monkeypatch):
    connection = MagicMock()
    connection.execute.return_value.scalar_one.return_value = 1
    connect = MagicMock()
    connect.return_value.__enter__.return_value = connection
    with app.app_context():
        monkeypatch.setattr(db.engine, "connect", connect)
        database.verify_database_connection()
    assert str(connection.execute.call_args.args[0]) == "SELECT 1"
    connect.return_value.__exit__.assert_called_once()


def test_database_failure_is_sanitized(app, monkeypatch):
    with app.app_context():
        def fail():
            raise OperationalError("secret_connection_string", {}, Exception("secret_password"))

        monkeypatch.setattr(db.engine, "connect", fail)
        with pytest.raises(database.DatabaseConnectionError) as error:
            database.verify_database_connection()
    assert "secret" not in str(error.value)
    assert "Database connection failed" in str(error.value)


def test_database_verification_rejects_unexpected_result(app, monkeypatch):
    connect = MagicMock()
    connect.return_value.__enter__.return_value.execute.return_value.scalar_one.return_value = 0
    with app.app_context():
        monkeypatch.setattr(db.engine, "connect", connect)
        with pytest.raises(database.DatabaseConnectionError, match="unexpected result"):
            database.verify_database_connection()


@pytest.mark.parametrize("succeeds", [True, False])
def test_check_db_command_exit_status(app, monkeypatch, succeeds):
    def verify():
        if not succeeds:
            raise database.DatabaseConnectionError("Database connection failed.")

    monkeypatch.setattr(database, "verify_database_connection", verify)
    result = app.test_cli_runner().invoke(args=["check-db"])
    assert result.exit_code == (0 if succeeds else 1)
    assert ("SELECT 1" if succeeds else "Database connection failed") in result.output
