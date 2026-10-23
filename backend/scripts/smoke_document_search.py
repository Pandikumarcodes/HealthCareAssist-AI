r"""Opt-in real PostgreSQL extraction/search test using exact fictional identities.

From backend: .\.venv\Scripts\python.exe scripts\smoke_document_search.py
Never migrates/resets a database. Only this run's PDFs/rows are removed.
"""

import json
from pathlib import Path
import sys
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

import pymupdf
from sqlalchemy import select, text
from werkzeug.serving import make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from app.document_processing import index_document
from app.documents import document_path, storage_directory
from app.extensions import db
from app.models import Document, DocumentChunk, SupportRequest
from smoke_documents import QuietHandler, files_snapshot, require, rows_snapshot


def pdf_bytes(pages):
    with pymupdf.open() as document:
        for passage in pages:
            page = document.new_page()
            require(page.insert_textbox(pymupdf.Rect(36, 36, 560, 790), passage, fontsize=10) >= 0,
                    "Synthetic PDF text did not fit.")
        return document.tobytes()


def main():
    application = create_app()
    with application.app_context():
        url = db.engine.url
        require(url.database == "healthcareassist_ai" and url.host in {"localhost", "127.0.0.1", "::1"}
                and url.port == 7498, "Dedicated local database on port 7498 required.")
        require(tuple(db.session.execute(text("SELECT current_database(), inet_server_port()")).one())
                == ("healthcareassist_ai", 7498), "Wrong connected database.")
        require(db.session.scalar(text("SELECT version_num FROM alembic_version")) == "9d82b6f31a04", "Apply reviewed migration first.")
        baseline_requests, baseline_documents, baseline_chunks = (
            rows_snapshot(model) for model in (SupportRequest, Document, DocumentChunk))
        root = storage_directory()
        baseline_files = files_snapshot(root)
    marker = "SYNTHETIC-STEP-4.2-" + uuid4().hex
    token = "fictional" + uuid4().hex
    filename = marker + ".pdf"
    passage = f"{token} coverage annual checkups. {token} coverage annual checkups. Fictional policy only."
    documents = [
        (marker + " first", pdf_bytes(["Fictional policy overview. Synthetic membership information.", passage])),
        (marker + " second", pdf_bytes([passage])),
        (marker + " third", pdf_bytes([f"{token} coverage. " + "Synthetic context. " * 30 + f"{token} coverage annual checkups."])),
    ]
    expected_bytes = dict(documents)
    attempted, created = set(), []
    server = make_server("127.0.0.1", 0, application, request_handler=QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"

    def http(method, path, data=None, headers=None, expected=200):
        try:
            response = urlopen(Request(origin + path, data=data, headers=headers or {}, method=method), timeout=25)
        except HTTPError as error:
            response = error
        with response:
            require(response.code == expected, f"Unexpected status for {method} endpoint.")
            raw = response.read()
            return json.loads(raw) if raw else None

    def search(query, limit=10):
        return http("GET", "/api/documents/search?" + urlencode({"q": query, "limit": limit}))

    try:
        baseline_dashboard = http("GET", "/api/dashboard/summary")
        for title, pdf in documents:
            attempted.add(title)
            boundary = "boundary-" + uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n'
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                    'Content-Type: application/pdf\r\n\r\n').encode() + pdf + f"\r\n--{boundary}--\r\n".encode()
            item = http("POST", "/api/documents", data=body,
                        headers={"Content-Type": "multipart/form-data; boundary=" + boundary}, expected=201)["data"]
            require(item["title"] == title and item["processing_status"] == "INDEXED", "Indexing outcome mismatch.")
            require(http("GET", f"/api/documents/{item['id']}") == {"data": item}, "Details mismatch.")
            created.append(item["id"])
            with application.app_context():
                row = db.session.get(Document, item["id"])
                require(document_path(row.stored_filename).read_bytes() == pdf, "Stored bytes mismatch.")
                chunks = db.session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == item["id"])
                                            .order_by(DocumentChunk.chunk_index)).all()
                require(len(chunks) == (2 if len(created) == 1 else 1), "Chunk count mismatch.")
                require([chunk.chunk_index for chunk in chunks] == list(range(len(chunks))), "Chunk ordering mismatch.")
        query = token + " coverage annual"
        response = search(query)
        results = response["results"]
        require(response["query"] == query and len(results) == 3, "Expected three actual PostgreSQL matches.")
        require([row["document_id"] for row in results] == created, "Ranking/tie order mismatch.")
        require(results[0]["score"] == results[1]["score"] > results[2]["score"] > 0, "PostgreSQL ranking mismatch.")
        require([row["page_number"] for row in results] == [2, 1, 1], "Page citations mismatch.")
        for row in results:
            require(set(row) == {"document_id", "document_title", "chunk_id", "page_number", "text", "score"}, "Unsafe search result fields.")
            require(token in row["text"] and 0 < len(row["text"]) <= 1200, "Passage mismatch or unbounded content.")
            require(row["document_title"] == documents[created.index(row["document_id"])][0], "Citation title mismatch.")
        require(search(query) == response, "Search tie ordering is unstable.")
        require(search(query, 1)["results"] == results[:1] and search(query, 2)["results"] == results[:2], "Result limit mismatch.")
        require(len(search(token + " annual checkups")["results"]) == 3, "Multiple-term matching failed.")
        require(len(search(token + " coverage!!!")["results"]) == 3, "Punctuation handling failed.")
        require(search("unmatched" + uuid4().hex)["results"] == [], "Unrelated query matched.")
        require(search("!!!")["results"] == [] and search("the and")["results"] == [], "Empty lexeme handling failed.")
        require(search(token + "'; DROP TABLE documents; --")["results"] == [], "Injection-like query handling failed.")
        http("GET", "/api/documents/search?q=", expected=400)
        http("GET", "/api/documents/search?q=coverage&limit=21", expected=400)
        with application.app_context():
            item = db.session.get(Document, created[2])
            item.processing_status = "FAILED"  # Exact synthetic record: prove exclusion of partial/nonindexed content.
            db.session.commit()
        require(len(search(query)["results"]) == 2, "Failed processing content was searchable.")
        with application.app_context():
            item = db.session.get(Document, created[2])
            item.processing_status = "INDEXED"
            db.session.commit()
            item = db.session.scalar(select(Document).where(Document.id == created[0]).with_for_update())
            before = [row.id for row in db.session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == item.id)
                                                         .order_by(DocumentChunk.chunk_index))]
            index_document(item)
            db.session.commit()
            after = [row.id for row in db.session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == item.id)
                                                        .order_by(DocumentChunk.chunk_index))]
            require(before == after, "Retry duplicated/replaced indexed chunks.")
            # Prove the indexed expression is usable; the tiny live fixture would
            # normally make PostgreSQL prefer a sequential scan.
            db.session.execute(text("SET LOCAL enable_seqscan = off"))
            plan = db.session.execute(text("EXPLAIN SELECT id FROM document_chunks "
                "WHERE to_tsvector('english'::regconfig, content) @@ plainto_tsquery('english'::regconfig, :q)"), {"q": token}).all()
            require("ix_document_chunks_search" in str(plan), "GIN index not usable by search expression.")
            db.session.rollback()
        print("Live upload/selectable extraction, chunks, title/page citations and retry idempotency: PASS.")
        print("Real PostgreSQL matching, multi-term/punctuation/stop words, ranking/ties, limits, status filtering and parameterized injection-like input: PASS.")
        print("PostgreSQL EXPLAIN confirms the GIN search index is usable: PASS.")
        for document_id in created:
            with application.app_context():
                stored = db.session.get(Document, document_id).stored_filename
            http("DELETE", f"/api/documents/{document_id}", expected=204)
            http("GET", f"/api/documents/{document_id}", expected=404)
            with application.app_context():
                require(db.session.scalar(select(DocumentChunk.id).where(DocumentChunk.document_id == document_id)) is None,
                        "Deleted document chunks remain.")
                require(not document_path(stored).exists(), "Deleted stored PDF remains.")
            require(all(row["document_id"] != document_id for row in search(query)["results"]), "Deleted content still searchable.")
        require(search(query)["results"] == [], "Synthetic content remained searchable after deletion.")
        require(http("GET", "/api/dashboard/summary") == baseline_dashboard, "Dashboard changed.")
        print("Live deletion removes chunks, stored PDFs, metadata and search visibility: PASS.")
    finally:
        try:
            with application.app_context():
                remaining = db.session.scalars(select(Document).where(Document.title.in_(attempted), Document.original_filename == filename)).all()
                identities = [(row.id, row.title, row.stored_filename) for row in remaining]
            for document_id, title, stored in identities:
                item = http("GET", f"/api/documents/{document_id}")["data"]
                require(item["title"] == title and item["original_filename"] == filename, "Cleanup identity mismatch.")
                with application.app_context():
                    require(document_path(stored).read_bytes() == expected_bytes[title], "Cleanup file identity mismatch.")
                http("DELETE", f"/api/documents/{document_id}", expected=204)
            with application.app_context():
                for model, baseline in ((SupportRequest, baseline_requests), (Document, baseline_documents), (DocumentChunk, baseline_chunks)):
                    require(rows_snapshot(model) == baseline, "Existing database rows changed.")
                require(files_snapshot(root) == baseline_files, "Existing stored files changed or smoke files remain.")
                print(f"Cleanup: documents={baseline_documents[0]}, chunks={baseline_chunks[0]}, files={len(baseline_files)}; exact baseline restored.")
                print(f"Existing support requests unchanged ({baseline_requests[0]} rows); only this run's synthetic identities removed.")
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
        print("Document extraction/search smoke test failed; exception details and extracted text suppressed.", file=sys.stderr)
        sys.exit(1)
