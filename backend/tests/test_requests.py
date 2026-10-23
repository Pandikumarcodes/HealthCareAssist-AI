from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from flask_migrate import upgrade
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app import create_app
from app.config import BACKEND_DIRECTORY
from app.extensions import db
from app.models import SupportRequest, utc_now
from app.support_requests import serialize_request


@pytest.fixture()
def app(tmp_path):
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'requests.sqlite').as_posix()}",
    })
    with application.app_context():
        upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
        yield application
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


def payload(**changes):
    return {"title": "Synthetic coverage question", "description": "Synthetic policy details.",
            "category": "COVERAGE", **changes}


def create(client, **changes):
    response = client.post("/api/requests", json=payload(**changes))
    assert response.status_code == 201
    return response.get_json()["data"]


def assert_validation(response, field):
    assert response.status_code == 400
    assert response.is_json
    assert response.get_json()["error"] == "Invalid input."
    assert field in response.get_json()["details"]


@pytest.mark.parametrize("category", ["GENERAL", "COVERAGE", "CLAIMS", "APPOINTMENT"])
def test_create_valid_request_and_default_open_status(client, category):
    item = create(client, title="  " + "x" * 200 + "  ", category=category)
    assert item["title"] == "x" * 200
    assert item["category"] == category
    assert item["status"] == "OPEN"
    assert item["id"] > 0
    assert set(item) == {"id", "title", "description", "category", "status", "created_at", "updated_at"}
    for key in ("created_at", "updated_at"):
        assert item[key].endswith("Z")
        assert datetime.fromisoformat(item[key]).utcoffset() == timedelta(0)
    assert client.get(f"/api/requests/{item['id']}").get_json() == {"data": item}


@pytest.mark.parametrize("field,value", [
    ("title", ""), ("title", " \t\n"), ("title", "x" * 201), ("title", None),
    ("title", 42), ("title", True), ("title", "bad\x00title"),
    ("description", ""), ("description", " \t"), ("description", None),
    ("description", []), ("description", "bad\x00description"),
    ("category", "INVALID"), ("category", "coverage"), ("category", " COVERAGE "),
    ("category", None), ("category", {}),
    ("status", "OPEN"), ("id", 1), ("created_at", "2026-01-01T00:00:00Z"),
    ("updated_at", "2026-01-01T00:00:00Z"), ("unknown", "value"),
])
def test_create_invalid_fields_do_not_write(client, field, value):
    assert_validation(client.post("/api/requests", json=payload(**{field: value})), field)
    assert client.get("/api/requests").get_json()["total"] == 0


@pytest.mark.parametrize("field", ["title", "description", "category"])
def test_create_required_fields(client, field):
    data = payload()
    del data[field]
    assert_validation(client.post("/api/requests", json=data), field)


@pytest.mark.parametrize("body,content_type", [
    ('{"title":', "application/json"), ("null", "application/json"),
    ("[]", "application/json"), ('"text"', "application/json"),
    ("true", "application/json"), ("42", "application/json"),
    ("", "application/json"), ('{"title":"text"}', "text/plain"),
])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_invalid_json_bodies(client, body, content_type, method):
    url = "/api/requests"
    if method == "patch":
        url += f"/{create(client)['id']}"
    assert_validation(getattr(client, method)(url, data=body, content_type=content_type), "body")


def test_description_uses_existing_text_contract(client):
    description = "Synthetic details. " * 1000
    assert create(client, description=description)["description"] == description.strip()


def test_empty_list_and_default_pagination(client):
    response = client.get("/api/requests")
    assert response.status_code == 200
    assert response.get_json() == {"data": [], "page": 1, "page_size": 20, "total": 0, "total_pages": 0}


@pytest.fixture()
def records(app):
    # Equal timestamps exercise the ID tie-breaker; the older, highest ID must sort last.
    now = utc_now()
    values = [
        ("Alpha coverage", "Synthetic details", "COVERAGE", "OPEN", now),
        ("Beta claim", "Synthetic ALPHA details", "CLAIMS", "IN_PROGRESS", now),
        ("Gamma visit", "Synthetic details", "APPOINTMENT", "RESOLVED", now),
        ("100% literal_name", "Synthetic details", "GENERAL", "OPEN", now - timedelta(days=1)),
    ]
    items = [SupportRequest(title=title, description=description, category=category,
                            status=status, created_at=created_at)
             for title, description, category, status, created_at in values]
    db.session.add_all(items)
    db.session.commit()
    return [item.id for item in items]


def test_pagination_newest_first_and_id_tiebreaker(client, records):
    first = client.get("/api/requests?page_size=2").get_json()
    second = client.get("/api/requests?page=2&page_size=2").get_json()
    assert [item["id"] for item in first["data"]] == [records[2], records[1]]
    assert [item["id"] for item in second["data"]] == [records[0], records[3]]
    assert first["total"] == second["total"] == 4
    assert first["total_pages"] == second["total_pages"] == 2
    assert second["page"] == 2 and second["page_size"] == 2
    beyond = client.get("/api/requests?page=3&page_size=2").get_json()
    assert beyond["data"] == [] and beyond["total"] == 4 and beyond["total_pages"] == 2
    maximum = client.get("/api/requests?page=2147483647&page_size=100")
    assert maximum.status_code == 200
    assert maximum.get_json()["data"] == []


@pytest.mark.parametrize("query,positions", [
    ("status=OPEN", [0, 3]), ("status=IN_PROGRESS", [1]), ("status=RESOLVED", [2]),
    ("category=COVERAGE", [0]), ("category=CLAIMS", [1]),
    ("category=APPOINTMENT", [2]), ("category=GENERAL", [3]),
    ("q=aLpHa", [1, 0]), ("q=%25", [3]), ("q=_", [3]),
    ("q=doesnotexist", []), ("q=%27%20OR%201%3D1%20--", []),
    ("status=OPEN&category=COVERAGE&q=alpha", [0]),
    ("status=RESOLVED&category=COVERAGE", []), ("q=%20%20", [2, 1, 0, 3]),
])
def test_filters_and_literal_case_insensitive_keyword_search(client, records, query, positions):
    response = client.get(f"/api/requests?{query}")
    assert response.status_code == 200
    body = response.get_json()
    assert [item["id"] for item in body["data"]] == [records[index] for index in positions]
    assert body["total"] == len(positions)
    assert body["total_pages"] == (1 if positions else 0)


def test_filtered_pagination_counts_matches_only(client, records):
    body = client.get("/api/requests?status=OPEN&page=2&page_size=1").get_json()
    assert body["total"] == 2 and body["total_pages"] == 2
    assert [item["id"] for item in body["data"]] == [records[3]]


@pytest.mark.parametrize("query,field", [
    ("page=0", "page"), ("page=-1", "page"), ("page=1.5", "page"),
    ("page=abc", "page"), ("page=", "page"), ("page=2147483648", "page"),
    ("page=" + "9" * 5000, "page"), ("page=%D9%A1", "page"),
    ("page_size=0", "page_size"), ("page_size=-1", "page_size"),
    ("page_size=101", "page_size"), ("page_size=1.5", "page_size"),
    ("page_size=", "page_size"), ("status=open", "status"), ("status=", "status"),
    ("category=BAD", "category"), ("category=", "category"),
    ("q=" + "x" * 201, "q"), ("q=%00", "q"), ("sort=title", "sort"),
    ("page=1&page=2", "page"), ("page_size=1&page_size=2", "page_size"),
    ("status=OPEN&status=RESOLVED", "status"), ("category=GENERAL&category=CLAIMS", "category"),
    ("q=one&q=two", "q"),
])
def test_invalid_query_parameters(client, query, field):
    assert_validation(client.get(f"/api/requests?{query}"), field)


def test_partial_and_combined_updates_maintain_timestamps(client):
    item = create(client)
    earlier = utc_now() - timedelta(days=1)
    stored = db.session.get(SupportRequest, item["id"])
    stored.created_at = earlier
    stored.updated_at = earlier
    db.session.commit()
    url = f"/api/requests/{item['id']}"
    response = client.patch(url, json={"title": "  Updated synthetic title  "})
    assert response.status_code == 200
    changed = response.get_json()["data"]
    assert changed["title"] == "Updated synthetic title"
    assert changed["category"] == "COVERAGE" and changed["status"] == "OPEN"
    assert datetime.fromisoformat(changed["created_at"]) == earlier
    assert datetime.fromisoformat(changed["updated_at"]) > earlier
    response = client.patch(url, json={"category": "CLAIMS", "status": "IN_PROGRESS",
                                       "description": "Updated synthetic details"})
    assert response.status_code == 200
    changed = response.get_json()["data"]
    assert (changed["category"], changed["status"], changed["description"]) == (
        "CLAIMS", "IN_PROGRESS", "Updated synthetic details")
    assert client.get(url).get_json()["data"] == changed
    # Workflow remains simple: any supported status can follow any other status.
    for status in ("RESOLVED", "OPEN"):
        assert client.patch(url, json={"status": status}).get_json()["data"]["status"] == status


@pytest.mark.parametrize("changes,field", [
    ({}, "body"), ({"title": ""}, "title"), ({"title": "x" * 201}, "title"),
    ({"title": None}, "title"), ({"title": "\x00"}, "title"),
    ({"description": " \n"}, "description"), ({"description": 42}, "description"),
    ({"category": "UNKNOWN"}, "category"), ({"category": None}, "category"),
    ({"status": "CLOSED"}, "status"), ({"status": "open"}, "status"),
    ({"status": []}, "status"), ({"status": None}, "status"),
    ({"id": 999}, "id"), ({"created_at": "2020-01-01"}, "created_at"),
    ({"updated_at": "2020-01-01"}, "updated_at"), ({"unknown": "x"}, "unknown"),
    ({"title": "Would change", "status": "INVALID"}, "status"),
])
def test_invalid_updates_leave_record_unchanged(client, changes, field):
    item = create(client)
    url = f"/api/requests/{item['id']}"
    assert_validation(client.patch(url, json=changes), field)
    assert client.get(url).get_json() == {"data": item}


def test_delete_removes_exact_record_and_returns_no_body(client):
    first, second = create(client), create(client, title="Synthetic retained record")
    response = client.delete(f"/api/requests/{first['id']}")
    assert response.status_code == 204 and response.data == b""
    assert client.get(f"/api/requests/{first['id']}").status_code == 404
    assert client.get(f"/api/requests/{second['id']}").get_json() == {"data": second}
    assert client.get("/api/requests").get_json()["total"] == 1


@pytest.mark.parametrize("request_id", ["999", "0", "-1", "abc", "1.5", "2147483648", "9" * 100])
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_missing_and_invalid_ids_return_json_404(client, request_id, method):
    response = getattr(client, method)(f"/api/requests/{request_id}", json={"status": "OPEN"})
    assert response.status_code == 404
    assert response.get_json() == {"error": "Support request not found."}


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
@pytest.mark.parametrize("error_type", [OperationalError, RuntimeError])
def test_write_failures_rollback_real_changes_and_allow_recovery(client, monkeypatch, caplog, method, error_type):
    existing = create(client)
    original_commit = db.session.commit
    original_rollback = db.session.rollback
    rollback = Mock(wraps=original_rollback)

    def fail():
        db.session.flush()  # Write first: rollback must actually undo insert/update/delete.
        if error_type is OperationalError:
            raise OperationalError("private sql", {}, Exception("secret credentials"))
        raise RuntimeError("secret credentials")

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", fail)
        patch.setattr(db.session, "rollback", rollback)
        url = "/api/requests" if method == "post" else f"/api/requests/{existing['id']}"
        response = getattr(client, method)(url, json=payload(title="Failed change"))
    assert response.status_code == 500
    assert response.get_json() == {"error": "Support request operation failed. Please try again."}
    rollback.assert_called_once()
    assert "secret" not in response.get_data(as_text=True) + caplog.text
    assert "private sql" not in caplog.text
    # Expire state and check persisted values as well as session recovery.
    db.session.expire_all()
    assert db.session.scalar(select(func.count(SupportRequest.id))) == 1
    assert client.get(f"/api/requests/{existing['id']}").get_json() == {"data": existing}
    assert db.session.commit == original_commit
    create(client, title="Synthetic recovery")
    assert client.get("/api/requests").get_json()["total"] == 2


@pytest.mark.parametrize("path,operation", [("/api/requests", "scalar"), ("/api/requests/1", "get")])
def test_read_database_failures_are_sanitized_and_rolled_back(client, monkeypatch, caplog, path, operation):
    def fail(*args, **kwargs):
        raise OperationalError("private sql", {}, Exception("secret credentials"))

    rollback = Mock(wraps=db.session.rollback)
    monkeypatch.setattr(db.session, operation, fail)
    monkeypatch.setattr(db.session, "rollback", rollback)
    response = client.get(path)
    assert response.status_code == 500 and response.is_json
    rollback.assert_called_once()
    assert "secret" not in response.get_data(as_text=True) + caplog.text
    assert "private sql" not in caplog.text
    assert client.get("/api/health").status_code == 200


def test_serializer_normalizes_timezone_to_utc():
    instant = datetime(2026, 1, 1, 12, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    item = SupportRequest(id=1, title="Synthetic", description="Details", category="GENERAL",
                          status="OPEN", created_at=instant, updated_at=instant)
    serialized = serialize_request(item)
    assert serialized["created_at"] == serialized["updated_at"] == "2026-01-01T06:30:00Z"


def test_dashboard_counts_reflect_create_update_delete(client):
    def counts(total, opened, progress, resolved):
        response = client.get("/api/dashboard/summary")
        assert response.status_code == 200
        assert response.get_json() == {
            "total_requests": total, "open_requests": opened,
            "in_progress_requests": progress, "resolved_requests": resolved,
        }

    counts(0, 0, 0, 0)
    first = create(client)
    counts(1, 1, 0, 0)
    second = create(client)
    counts(2, 2, 0, 0)
    assert client.patch(f"/api/requests/{first['id']}", json={"status": "IN_PROGRESS"}).status_code == 200
    counts(2, 1, 1, 0)
    assert client.patch(f"/api/requests/{first['id']}", json={"status": "RESOLVED"}).status_code == 200
    counts(2, 1, 0, 1)
    assert client.delete(f"/api/requests/{first['id']}").status_code == 204
    counts(1, 1, 0, 0)
    assert client.delete(f"/api/requests/{second['id']}").status_code == 204
    counts(0, 0, 0, 0)
