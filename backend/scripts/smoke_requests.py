r"""Opt-in HTTP CRUD check against the dedicated local development database.

Run from backend: .\.venv\Scripts\python.exe scripts\smoke_requests.py
Only uniquely labeled records created by this run are deleted. Never resets a DB.
"""

import json
from pathlib import Path
import sys
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import select, text
from werkzeug.serving import WSGIRequestHandler, make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from app.extensions import db
from app.models import SupportRequest


class QuietHandler(WSGIRequestHandler):
    def log(self, type, message, *args):
        pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    application = create_app()
    with application.app_context():
        url = db.engine.url
        require(url.database == "healthcareassist_ai", "Dedicated database required.")
        require(url.host in {"localhost", "127.0.0.1", "::1"}, "Local server required.")
        with db.engine.connect() as connection:
            require(connection.scalar(text("SELECT current_database()")) == "healthcareassist_ai",
                    "Connected database did not match.")

    server = make_server("127.0.0.1", 0, application, request_handler=QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    marker = f"SYNTHETIC STEP 3.1 {uuid4().hex}"
    attempted_titles = set()
    created = {}

    def http(method, path, body=None, expected=200):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        try:
            response = urlopen(Request(origin + path, data=data, headers=headers, method=method), timeout=10)
        except HTTPError as error:
            response = error
        with response:
            require(response.code == expected, f"Unexpected status for {method} {path}.")
            raw = response.read()
            return json.loads(raw) if raw else None

    def counts(total=0, opened=0, progress=0, resolved=0):
        expected = dict(baseline)
        for key, change in (("total_requests", total), ("open_requests", opened),
                            ("in_progress_requests", progress), ("resolved_requests", resolved)):
            expected[key] += change
        require(http("GET", "/api/dashboard/summary") == expected, "Dashboard count mismatch.")

    try:
        baseline = http("GET", "/api/dashboard/summary")
        print("Verified database: healthcareassist_ai (local PostgreSQL).")
        print("Baseline dashboard: " + json.dumps(baseline, sort_keys=True))
        for index, category in enumerate(("COVERAGE", "CLAIMS"), start=1):
            title = f"{marker} record {index}"
            attempted_titles.add(title)
            item = http("POST", "/api/requests", {
                "title": title, "description": marker, "category": category,
            }, expected=201)["data"]
            created[item["id"]] = title
            require(item["status"] == "OPEN", "Default status mismatch.")
            require(item["created_at"].endswith("Z") and item["updated_at"].endswith("Z"),
                    "UTC timestamps required.")
            counts(index, index)

        first, second = created
        original = http("GET", f"/api/requests/{first}")["data"]
        require(original["title"] == created[first], "Details mismatch.")
        query = urlencode({"q": marker, "page_size": 1})
        page = http("GET", f"/api/requests?{query}")
        require(page["total"] == 2 and page["total_pages"] == 2 and len(page["data"]) == 1,
                "Pagination mismatch.")
        require(http("GET", f"/api/requests?{query}&page=2")["data"][0]["id"] != page["data"][0]["id"],
                "Pagination repeated a record.")
        for status, deltas in (("IN_PROGRESS", (2, 1, 1, 0)), ("RESOLVED", (2, 1, 0, 1))):
            updated = http("PATCH", f"/api/requests/{first}", {"status": status, "category": "APPOINTMENT"})["data"]
            require(updated["status"] == status and updated["category"] == "APPOINTMENT", "Update mismatch.")
            require(updated["created_at"] == original["created_at"] and
                    updated["updated_at"] > original["updated_at"], "Timestamp update mismatch.")
            counts(*deltas)
        filtered = http("GET", "/api/requests?" + urlencode({"q": marker, "status": "RESOLVED", "category": "APPOINTMENT"}))
        require(filtered["total"] == 1 and filtered["data"][0]["id"] == first, "Filter mismatch.")
        http("PATCH", f"/api/requests/{first}", {"status": "INVALID"}, expected=400)
        counts(2, 1, 0, 1)
        http("DELETE", f"/api/requests/{first}", expected=204)
        counts(1, 1)
        http("GET", f"/api/requests/{first}", expected=404)
        http("DELETE", f"/api/requests/{second}", expected=204)
        counts()
        print("HTTP create/list/pagination/search/filters/details/update/delete and 400/404 checks passed.")
        print("Dashboard deltas verified after both creates, both status updates, and both deletes.")
    finally:
        try:
            # Recover exact identities even if a POST committed but its response was lost.
            with application.app_context():
                remaining = list(db.session.execute(
                    select(SupportRequest.id, SupportRequest.title).where(
                        SupportRequest.title.in_(attempted_titles), SupportRequest.description == marker,
                    )
                ).all()) if attempted_titles else []
            for request_id, title in remaining:
                item = http("GET", f"/api/requests/{request_id}")["data"]
                require(item["title"] == title and item["description"] == marker, "Cleanup identity mismatch.")
                http("DELETE", f"/api/requests/{request_id}", expected=204)
            if "baseline" in locals():
                counts()
                print("Exact synthetic records cleaned up; dashboard restored to baseline.")
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
            with application.app_context():
                db.session.remove()
                db.engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print exceptions that could contain SQL or database credentials.
        print("Live CRUD verification failed; review local configuration and server availability.", file=sys.stderr)
        sys.exit(1)
