"""Read-only inventory; never print credentials or configuration values."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))
paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
paths = [p for p in paths if p and not p.startswith(".verification-artifacts/e2e-step-6.3/") and (ROOT / p).is_file()] + ["backend/.env"]
baseline = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
            "status": subprocess.check_output(["git", "status", "--short"], cwd=ROOT).decode(),
            "digests": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}}
(OUT / "baseline.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
from app.config import local_configuration
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
config = local_configuration()
url = make_url(config["SQLALCHEMY_DATABASE_URI"])
report = {"python": sys.version.split()[0], "node": subprocess.check_output(["node", "--version"]).decode().strip(),
          "packages": {name: importlib.metadata.version(name) for name in ("Flask", "SQLAlchemy", "Flask-Migrate", "psycopg", "pytest", "PyMuPDF", "google-genai")},
          "database": {"host": url.host, "port": url.port, "database": url.database, "driver": url.drivername,
                       "application_credentials_available": bool(url.username and url.password)},
          "dedicated_test_environment_present": any(os.getenv(n) for n in ("TEST_DATABASE_URL", "E2E_DATABASE_URL"))}
assert url.host in {"localhost", "127.0.0.1"} and url.port == 7498
engine = create_engine(url, connect_args={"connect_timeout": 5, "options": "-c default_transaction_read_only=on -c statement_timeout=5000"})
try:
    with engine.connect() as connection:
        report["postgresql"] = {"connected": True, "read_only": connection.scalar(text("SHOW transaction_read_only")),
            "role": dict(connection.execute(text("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user")).mappings().one()),
            "databases": [dict(row) for row in connection.execute(text("SELECT datname AS name, pg_get_userbyid(datdba)=current_user AS owned_by_current_role, obj_description(oid, 'pg_database') AS description FROM pg_database WHERE NOT datistemplate ORDER BY datname")).mappings()]}
except Exception as error:
    report["postgresql"] = {"connected": False, "error_type": type(error).__name__}
finally:
    engine.dispose()
(OUT / "environment.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
