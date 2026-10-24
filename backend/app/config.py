import os
from datetime import timedelta
from pathlib import Path


BACKEND_DIRECTORY = Path(__file__).resolve().parent.parent


class Config:
    """Default application configuration for local development."""

    DEBUG = False
    TESTING = False
    SECRET_KEY = None
    DEMO_USERNAME = ""
    DEMO_PASSWORD_HASH = ""
    SESSION_COOKIE_NAME = "healthcareassist_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_PATH = "/api"
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)
    SESSION_REFRESH_EACH_REQUEST = False
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DOCUMENT_UPLOAD_DIR = str(BACKEND_DIRECTORY / "instance" / "document_uploads")
    GEMINI_API_KEY = ""
    GEMINI_MODEL = "gemini-3.5-flash-lite"
    GEMINI_TIMEOUT_SECONDS = 20
    GEMINI_MAX_OUTPUT_TOKENS = 1024


class TestingConfig(Config):
    """Safe configuration used by the automated test suite."""

    DEBUG = False
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"


def local_configuration() -> dict[str, object]:
    """Read local settings at factory time; environment values take precedence."""
    # PDF workers need BACKEND_DIRECTORY, never local settings or the ORM.
    from dotenv import load_dotenv
    from sqlalchemy.engine import URL

    load_dotenv(BACKEND_DIRECTORY / ".env", override=False)
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        names = ("DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME")
        if any(os.getenv(name) is None for name in names):
            raise RuntimeError(
                "Set DATABASE_URL or all DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, "
                "DB_NAME settings in the environment or backend/.env."
            )
        try:
            port = int(os.environ["DB_PORT"])
            if not 1 <= port <= 65535:
                raise ValueError()
        except ValueError:
            raise RuntimeError("DB_PORT must be an integer from 1 to 65535.") from None
        if any(not os.environ[name].strip() for name in ("DB_HOST", "DB_USER", "DB_NAME")):
            raise RuntimeError("DB_HOST, DB_USER, and DB_NAME must not be empty.")
        database_url = URL.create(
            "postgresql+psycopg",
            username=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
            host=os.environ["DB_HOST"],
            port=port,
            database=os.environ["DB_NAME"],
        )
    # Explicitly select psycopg 3 for common provider-supplied PostgreSQL URLs.
    for prefix in ("postgres://", "postgresql://"):
        if isinstance(database_url, str) and database_url.startswith(prefix):
            database_url = "postgresql+psycopg://" + database_url[len(prefix):]
            break
    if isinstance(database_url, str) and not database_url.startswith("postgresql+psycopg://"):
        raise RuntimeError("DATABASE_URL must use PostgreSQL with the psycopg driver.")
    return {
        "SECRET_KEY": os.getenv("SECRET_KEY", ""),
        "DEMO_USERNAME": os.getenv("DEMO_USERNAME", "").strip(),
        "DEMO_PASSWORD_HASH": os.getenv("DEMO_PASSWORD_HASH", ""),
        # HTTPS is the safe default; explicitly opt out only for local HTTP.
        "SESSION_COOKIE_SECURE": os.getenv("SESSION_COOKIE_SECURE", "true").lower() != "false",
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", "").strip(),
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", Config.GEMINI_MODEL).strip(),
        "GEMINI_TIMEOUT_SECONDS": os.getenv("GEMINI_TIMEOUT_SECONDS", "20"),
        "GEMINI_MAX_OUTPUT_TOKENS": os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1024"),
        "DOCUMENT_UPLOAD_DIR": os.getenv("DOCUMENT_UPLOAD_DIR", "").strip()
        or str(BACKEND_DIRECTORY / "instance" / "document_uploads"),
        "DEBUG": os.getenv("FLASK_DEBUG", "false").lower() == "true",
        "SQLALCHEMY_DATABASE_URI": database_url,
        "SQLALCHEMY_ENGINE_OPTIONS": {
            "pool_pre_ping": True,
            "connect_args": {"connect_timeout": 5},
        },
    }
