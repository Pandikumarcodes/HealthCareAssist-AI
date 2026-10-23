r"""Opt-in live fictional PDF CRUD smoke test; never resets or migrates a database.

From backend: .\.venv\Scripts\python.exe scripts\smoke_documents.py
Only this run's exact synthetic identities are deleted. No extraction is used.
"""

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from pypdf import PdfWriter
from sqlalchemy import select, text
from werkzeug.serving import WSGIRequestHandler, make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from app.documents import document_path, storage_directory
from app.extensions import db
from app.models import Document, SupportRequest


class QuietHandler(WSGIRequestHandler):
    def log(self, type, message, *args):
        pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def rows_snapshot(model):
    rows = db.session.execute(select(model.__table__).order_by(model.id)).all()
    return len(rows), sha256(repr(rows).encode()).hexdigest()


def files_snapshot(root):
    return sorted((str(path.relative_to(root)), path.stat().st_size, sha256(path.read_bytes()).hexdigest())
                  for path in root.rglob("*") if path.is_file()) if root.exists() else []


def main():
    application = create_app()
    with application.app_context():
        url = db.engine.url
        require(url.database == "healthcareassist_ai" and url.host in {"localhost", "127.0.0.1", "::1"}
                and url.port == 7498, "Expected dedicated local PostgreSQL on port 7498.")
        require(db.session.scalar(text("SELECT current_database()")) == "healthcareassist_ai", "Wrong database.")
        require(db.session.scalar(text("SELECT version_num FROM alembic_version")) == "9d82b6f31a04", "Apply reviewed migration first.")
        baseline_requests = rows_snapshot(SupportRequest)
        baseline_documents = rows_snapshot(Document)
        root = storage_directory()
        baseline_files = files_snapshot(root)

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": "Fictional smoke-test policy; synthetic data only"})
    stream = BytesIO()
    writer.write(stream)
    pdf = stream.getvalue()
    marker = "SYNTHETIC-STEP-4.1-" + uuid4().hex
    filename = marker + ".pdf"
    titles = [marker + " one", marker + " two"]
    attempted = set()
    server = make_server("127.0.0.1", 0, application, request_handler=QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"

    def http(method, path, data=None, headers=None, expected=200):
        try:
            response = urlopen(Request(origin + path, data=data, headers=headers or {}, method=method), timeout=15)
        except HTTPError as error:
            response = error
        with response:
            require(response.code == expected, f"Unexpected HTTP status for {method} {path}.")
            body = response.read()
            return json.loads(body) if body else None

    try:
        baseline_dashboard = http("GET", "/api/dashboard/summary")
        created = []
        for title in titles:
            attempted.add(title)
            boundary = "boundary-" + uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n'
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                    'Content-Type: application/pdf\r\n\r\n').encode() + pdf + f"\r\n--{boundary}--\r\n".encode()
            item = http("POST", "/api/documents", data=body,
                        headers={"Content-Type": "multipart/form-data; boundary=" + boundary}, expected=201)["data"]
            require(item["title"] == title and item["original_filename"] == filename, "Upload metadata mismatch.")
            require(item["file_size"] == len(pdf) and item["content_type"] == "application/pdf", "File metadata mismatch.")
            require(set(item) == {"id", "title", "original_filename", "file_size", "content_type", "created_at", "processing_status"}, "Unsafe metadata fields.")
            require(item["processing_status"] == "NO_TEXT", "Blank PDF must have explicit NO_TEXT outcome.")
            require(item["created_at"].endswith("Z"), "Expected UTC timestamp.")
            require(http("GET", f"/api/documents/{item['id']}") == {"data": item}, "Details mismatch.")
            with application.app_context():
                row = db.session.get(Document, item["id"])
                require(document_path(row.stored_filename).read_bytes() == pdf, "Stored PDF mismatch.")
                created.append((item["id"], row.stored_filename))
        require(len({name for _, name in created}) == 2, "Internal names must be unique.")
        page = http("GET", "/api/documents?page_size=1")
        require(page["total"] == baseline_documents[0] + 2 and len(page["data"]) == 1, "List mismatch.")
        require(page["data"][0]["id"] == created[-1][0], "Newest-first order mismatch.")
        require(http("GET", "/api/documents?page_size=1&page=2")["data"][0]["id"] == created[0][0], "Pagination mismatch.")
        http("GET", "/api/documents?page_size=0", expected=400)
        http("POST", "/api/documents", data=b"{}", headers={"Content-Type": "application/json"}, expected=400)
        for document_id, stored in created:
            http("DELETE", f"/api/documents/{document_id}", expected=204)
            http("GET", f"/api/documents/{document_id}", expected=404)
            http("DELETE", f"/api/documents/{document_id}", expected=404)
            with application.app_context():
                require(not document_path(stored).exists(), "Deleted file remains.")
        require(http("GET", "/api/dashboard/summary") == baseline_dashboard, "Dashboard changed.")
        print("Live HTTP PDF upload (201), list/pagination (200), details (200), delete (204), 400/404: PASS.")
        print("Duplicate original names, unique storage names, stored bytes, UTC and safe metadata: PASS.")
    finally:
        try:
            # Recover exact synthetic identities even after a lost POST response.
            with application.app_context():
                remaining = db.session.scalars(select(Document).where(
                    Document.title.in_(attempted), Document.original_filename == filename,
                )).all()
                identities = [(row.id, row.title, row.stored_filename) for row in remaining]
            for document_id, title, stored in identities:
                item = http("GET", f"/api/documents/{document_id}")["data"]
                require(item["title"] == title and item["original_filename"] == filename, "Cleanup identity mismatch.")
                with application.app_context():
                    require(document_path(stored).read_bytes() == pdf, "Cleanup file identity mismatch.")
                http("DELETE", f"/api/documents/{document_id}", expected=204)
            with application.app_context():
                require(rows_snapshot(SupportRequest) == baseline_requests, "Existing support requests changed.")
                require(rows_snapshot(Document) == baseline_documents, "Existing documents changed.")
                require(files_snapshot(root) == baseline_files, "Upload directory not restored to baseline.")
                print(f"Cleanup verified: documents restored to {baseline_documents[0]} rows, support requests unchanged ({baseline_requests[0]} rows).")
                print(f"Storage manifest restored exactly ({len(baseline_files)} existing files); only this run's PDFs/records removed.")
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
        print("Document smoke verification failed; inspect local configuration/state without logging secrets.", file=sys.stderr)
        sys.exit(1)
