"""Final catalog-only read-only comparison; never inspect application records."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))
from app.config import local_configuration
from sqlalchemy import create_engine, text

engine = create_engine(local_configuration()["SQLALCHEMY_DATABASE_URI"], connect_args={"connect_timeout": 5, "options": "-c default_transaction_read_only=on -c statement_timeout=5000"})
with engine.connect() as connection:
    names = connection.execute(text("SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname")).scalars().all()
    prior = json.loads((OUT / "environment.json").read_text(encoding="utf-8"))
    assert names == [row["name"] for row in prior["postgresql"]["databases"]]
    assert not connection.scalar(text("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'hca_e2e_63_%'"))
    result = {"read_only": connection.scalar(text("SHOW transaction_read_only")), "postgres_version": connection.scalar(text("SHOW server_version")), "original_database_catalog_unchanged": True, "test_roles_remaining": 0}
engine.dispose()
(OUT / "catalog-after.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
