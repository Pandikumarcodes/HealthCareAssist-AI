from datetime import timedelta

import pytest
from flask_migrate import upgrade
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from app import create_app
from app.config import BACKEND_DIRECTORY
from app.extensions import db
from app.models import SupportRequest, utc_now


@pytest.fixture()
def app(tmp_path):
    # Apply the real migration to a disposable SQLite database, never local PostgreSQL.
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'dashboard.sqlite').as_posix()}",
    })
    with application.app_context():
        upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
        yield application
        db.session.remove()
        db.engine.dispose()


def test_empty_dashboard_summary(app, authenticated_client):
    response = authenticated_client(app).get("/api/dashboard/summary")
    assert response.status_code == 200
    assert response.get_json() == {
        "total_requests": 0, "open_requests": 0,
        "in_progress_requests": 0, "resolved_requests": 0,
    }


def test_summary_counts_all_statuses_consistently(app, authenticated_client):
    statuses = ["OPEN", "OPEN", "OPEN", "IN_PROGRESS", "IN_PROGRESS", "RESOLVED"]
    db.session.add_all([
        SupportRequest(title=f"Request {index}", description="Details", status=status)
        for index, status in enumerate(statuses)
    ])
    db.session.commit()
    response = authenticated_client(app).get("/api/dashboard/summary")
    assert response.status_code == 200
    summary = response.get_json()
    assert summary == {
        "total_requests": 6, "open_requests": 3,
        "in_progress_requests": 2, "resolved_requests": 1,
    }
    assert all(type(value) is int and value >= 0 for value in summary.values())
    assert summary["total_requests"] == sum(summary[key] for key in (
        "open_requests", "in_progress_requests", "resolved_requests",
    ))


@pytest.mark.parametrize("field,value", [
    ("status", "UNKNOWN"), ("status", "open"), ("category", "INVALID"),
    ("title", ""), ("title", " " * 3), ("title", "x" * 201),
    ("title", None), ("description", None), ("status", None), ("category", None),
])
def test_database_rejects_invalid_values(app, field, value):
    values = dict(title="Request", description="Details", status="OPEN", category="GENERAL")
    values[field] = value
    # Core insert bypasses ORM validation and tests the actual database constraints.
    with pytest.raises(IntegrityError):
        db.session.execute(insert(SupportRequest.__table__).values(**values))
        db.session.commit()
    db.session.rollback()


@pytest.mark.parametrize("category", ["GENERAL", "COVERAGE", "CLAIMS", "APPOINTMENT"])
def test_supported_categories_and_defaults(app, category):
    request = SupportRequest(title="x" * 200, description="Details", category=category)
    db.session.add(request)
    db.session.flush()
    assert request.status == "OPEN"
    assert request.created_at.utcoffset() == timedelta(0)
    assert request.updated_at.utcoffset() == timedelta(0)
    assert request.id > 0


def test_database_defaults_apply_to_raw_insert(app):
    db.session.execute(db.text(
        "INSERT INTO support_requests (title, description) VALUES ('Request', 'Details')"
    ))
    db.session.commit()
    request = db.session.execute(select(SupportRequest)).scalar_one()
    assert request.status == "OPEN"
    assert request.category == "GENERAL"
    assert request.created_at is not None
    assert request.updated_at is not None


def test_orm_update_refreshes_updated_at(app):
    earlier = utc_now() - timedelta(days=1)
    request = SupportRequest(title="Before", description="Details", created_at=earlier, updated_at=earlier)
    db.session.add(request)
    db.session.flush()
    request.title = "After"
    db.session.flush()
    assert request.created_at == earlier
    assert request.updated_at > earlier
    assert request.updated_at.utcoffset() == timedelta(0)


def test_database_rejects_invalid_status_update(app):
    request = SupportRequest(title="Request", description="Details")
    db.session.add(request)
    db.session.commit()
    with pytest.raises(IntegrityError):
        db.session.execute(update(SupportRequest).values(status="UNKNOWN"))
        db.session.commit()
    db.session.rollback()


def test_database_failure_is_sanitized_and_health_stays_available(app, monkeypatch, caplog, authenticated_client):
    def fail(*args, **kwargs):
        raise OperationalError("private sql", {}, Exception("secret password"))

    monkeypatch.setattr(db.session, "execute", fail)
    response = authenticated_client(app).get("/api/dashboard/summary")
    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Dashboard summary is temporarily unavailable. Please try again."
    }
    assert "secret" not in response.get_data(as_text=True) + caplog.text
    assert "private sql" not in caplog.text
    health = authenticated_client(app).get("/api/health")
    assert health.status_code == 200
    assert health.get_json() == {
        "status": "healthy", "service": "HealthCareAssist AI", "version": "1.0.0",
    }
