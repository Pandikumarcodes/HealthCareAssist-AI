from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from subprocess import TimeoutExpired
import sys
from types import SimpleNamespace
from unittest.mock import Mock

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
import pymupdf
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, OperationalError

from app import create_app, document_processing, document_search, pdf_extraction
from app.config import BACKEND_DIRECTORY
from app.document_processing import index_document
from app.documents import document_path
from app.extensions import db
from app.models import Document, DocumentChunk
from app.pdf_extraction import ExtractionError, extract_chunks, extract_pages, normalize_text, split_page


@pytest.fixture()
def app(tmp_path):
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'processing.sqlite').as_posix()}",
        "DOCUMENT_UPLOAD_DIR": str(tmp_path / "private_uploads"),
    })
    with application.app_context():
        upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
        application.logger.disabled = False
        yield application
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


def make_pdf(*pages, encrypted=False):
    with pymupdf.open() as document:
        for content in pages:
            page = document.new_page()
            if content:
                assert page.insert_textbox(pymupdf.Rect(36, 36, 560, 790), content, fontsize=10) >= 0
        options = {"encryption": pymupdf.PDF_ENCRYPT_AES_256, "owner_pw": "fictional", "user_pw": "fictional"} if encrypted else {}
        return document.tobytes(**options)


def upload(client, content):
    return client.post("/api/documents", data={"file": (BytesIO(content), "fictional-policy.pdf"), "title": "Fictional Policy"})


def chunks_for(document_id):
    return db.session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == document_id)
                              .order_by(DocumentChunk.chunk_index)).all()


def unprocessed_document(app, content):
    root = Path(app.config["DOCUMENT_UPLOAD_DIR"])
    root.mkdir(exist_ok=True)
    row = Document(title="Fictional existing", original_filename="fictional.pdf", stored_filename="a" * 32 + ".pdf",
                   content_type="application/pdf", file_size=len(content))
    db.session.add(row)
    db.session.commit()
    document_path(row.stored_filename).write_bytes(content)
    return row


def test_extract_text_multiple_pages_and_citations(tmp_path):
    path = tmp_path / "fictional.pdf"
    path.write_bytes(make_pdf("Fictional coverage includes annual checkups.", "", "Synthetic dental benefits require authorization."))
    chunks = extract_chunks(path)
    assert [(row["page_number"], row["chunk_index"]) for row in chunks] == [(1, 0), (3, 1)]
    assert "annual checkups" in chunks[0]["content"]
    assert "dental benefits" in chunks[1]["content"]
    assert extract_chunks(path) == chunks


def test_normalization_and_chunk_context():
    assert normalize_text("  Fictional\ncoverage\t includes\x00checkups.  ") == "Fictional coverage includes checkups."
    source = normalize_text("Fictional coverage for annual checkups. " * 120)
    chunks = list(split_page(source))
    assert chunks == list(split_page(source))
    assert all(0 < len(chunk) <= 1200 for chunk in chunks)
    assert len(chunks) > 1 and chunks[0][-80:] in chunks[1]
    assert chunks[-1].endswith("checkups.")


@pytest.mark.parametrize("text", ["", "x", "x" * 1200, "x" * 2401, "word " * 800])
def test_chunking_terminates_and_is_bounded(text):
    chunks = list(split_page(text))
    assert len(chunks) <= 5
    assert all(len(chunk) <= 1200 for chunk in chunks)
    if text:
        assert chunks


def test_empty_and_image_only_pdfs_are_no_text(client):
    with pymupdf.open() as document:
        page = document.new_page()
        image = pymupdf.Pixmap(pymupdf.csRGB, (0, 0, 2, 2), False)
        image.clear_with(255)
        page.insert_image(pymupdf.Rect(10, 10, 40, 40), pixmap=image)
        image_pdf = document.tobytes()
    for content in (make_pdf(""), image_pdf):
        response = upload(client, content)
        assert response.status_code == 201
        item = response.get_json()["data"]
        assert item["processing_status"] == "NO_TEXT"
        assert chunks_for(item["id"]) == []
        assert client.get(f"/api/documents/{item['id']}").status_code == 200
        assert client.delete(f"/api/documents/{item['id']}").status_code == 204


@pytest.mark.parametrize("content", [b"not a PDF", b"%PDF-1.7\nbroken\n%%EOF", b""])
def test_invalid_extraction_input_is_sanitized(tmp_path, content):
    path = tmp_path / "private-path.pdf"
    path.write_bytes(content)
    with pytest.raises(ExtractionError) as error:
        extract_chunks(path)
    assert str(path) not in str(error.value)


def test_encrypted_pdf_extraction_and_upload(tmp_path, client):
    content = make_pdf("Fictional encrypted text.", encrypted=True)
    path = tmp_path / "encrypted.pdf"
    path.write_bytes(content)
    with pytest.raises(ExtractionError):
        extract_chunks(path)
    assert upload(client, content).status_code == 400


def fake_document(pages):
    return SimpleNamespace(is_pdf=True, is_encrypted=False, needs_pass=False, is_repaired=False,
        page_count=len(pages), load_page=lambda index: SimpleNamespace(get_text=lambda *args, **kwargs: pages[index]))


def test_excessive_page_count(tmp_path, client):
    content = make_pdf(*([""] * 101))
    path = tmp_path / "too-many.pdf"
    path.write_bytes(content)
    with pytest.raises(ExtractionError):
        extract_chunks(path)
    response = upload(client, content)
    assert response.status_code == 201 and response.get_json()["data"]["processing_status"] == "FAILED"
    assert chunks_for(response.get_json()["data"]["id"]) == []


def test_excessive_page_text_and_total_text():
    with pytest.raises(ExtractionError):
        extract_pages(fake_document(["x" * 100_001]))
    with pytest.raises(ExtractionError):
        extract_pages(fake_document(["x" * 100_000] * 11))


def test_chunk_count_limit(monkeypatch):
    monkeypatch.setattr(pdf_extraction, "MAX_CHUNKS", 1)
    with pytest.raises(ExtractionError):
        extract_pages(fake_document(["Fictional " * 200]))


@pytest.mark.parametrize("field,value", [("is_pdf", False), ("is_repaired", True), ("is_encrypted", True), ("needs_pass", True)])
def test_core_rejects_unreadable_documents(field, value):
    document = fake_document(["Fictional"])
    setattr(document, field, value)
    with pytest.raises(ExtractionError):
        extract_pages(document)


def test_upload_persists_complete_chunks_atomically(client):
    response = upload(client, make_pdf("Fictional coverage includes annual checkups.", "Synthetic dental benefits."))
    assert response.status_code == 201
    item = response.get_json()["data"]
    assert item["processing_status"] == "INDEXED"
    rows = chunks_for(item["id"])
    assert len(rows) == 2 and [row.page_number for row in rows] == [1, 2]
    assert [row.chunk_index for row in rows] == [0, 1]
    assert all(row.document_id == item["id"] for row in rows)
    assert all(datetime.fromisoformat(row.created_at.replace(tzinfo=None).isoformat()) for row in rows)


def test_retry_idempotency_preserves_chunk_ids(app):
    item = unprocessed_document(app, make_pdf("Fictional coverage.", "Synthetic dental benefits."))
    index_document(item)
    db.session.commit()
    before = [(row.id, row.chunk_index, row.content) for row in chunks_for(item.id)]
    index_document(item)
    db.session.commit()
    assert [(row.id, row.chunk_index, row.content) for row in chunks_for(item.id)] == before
    assert len(before) == 2


def test_failed_processing_clears_partial_chunks_and_can_retry(app, monkeypatch):
    item = unprocessed_document(app, make_pdf("Fictional annual coverage."))
    db.session.add(DocumentChunk(document_id=item.id, page_number=1, chunk_index=0, content="Old partial synthetic text"))
    db.session.commit()
    with monkeypatch.context() as patch:
        patch.setattr(document_processing, "extract_chunks", Mock(side_effect=ExtractionError("private text/path")))
        index_document(item)
        db.session.commit()
    assert item.processing_status == "FAILED" and chunks_for(item.id) == []
    index_document(item)
    db.session.commit()
    assert item.processing_status == "INDEXED" and len(chunks_for(item.id)) == 1


def test_processing_failure_keeps_management_and_logs_no_text(app, client, monkeypatch, caplog):
    with monkeypatch.context() as patch:
        patch.setattr(document_processing, "extract_chunks", Mock(side_effect=ExtractionError("SECRET DOCUMENT TEXT")))
        response = upload(client, make_pdf("Fictional coverage."))
    assert response.status_code == 201
    item = response.get_json()["data"]
    assert item["processing_status"] == "FAILED" and chunks_for(item["id"]) == []
    assert "SECRET" not in caplog.text + response.get_data(as_text=True)
    assert client.get(f"/api/documents/{item['id']}").status_code == 200
    assert client.delete(f"/api/documents/{item['id']}").status_code == 204


def test_processing_database_failure_rolls_back_file_metadata_and_chunks(app, client, monkeypatch):
    def fail():
        raise OperationalError("secret SQL", {}, Exception("secret text"))

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", fail)
        response = upload(client, make_pdf("Fictional coverage."))
    assert response.status_code == 500 and "secret" not in response.get_data(as_text=True)
    assert db.session.scalar(select(func.count(Document.id))) == 0
    assert db.session.scalar(select(func.count(DocumentChunk.id))) == 0
    assert list(Path(app.config["DOCUMENT_UPLOAD_DIR"]).iterdir()) == []


def test_delete_cascades_chunks_and_failed_delete_preserves_them(client, monkeypatch):
    item = upload(client, make_pdf("Fictional coverage.")).get_json()["data"]
    row = db.session.get(Document, item["id"])
    path = document_path(row.stored_filename)
    ids = [chunk.id for chunk in chunks_for(item["id"])]
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", Mock(side_effect=OperationalError("secret", {}, Exception("secret"))))
        assert client.delete(f"/api/documents/{item['id']}").status_code == 500
    assert [chunk.id for chunk in chunks_for(item["id"])] == ids and path.exists()
    assert client.delete(f"/api/documents/{item['id']}").status_code == 204
    assert chunks_for(item["id"]) == [] and not path.exists()


def test_processing_cli_for_existing_document_and_idempotency(app):
    item = unprocessed_document(app, make_pdf("Fictional outpatient coverage."))
    runner = app.test_cli_runner()
    assert "INDEXED" in runner.invoke(args=["process-document", str(item.id)]).output
    before = [chunk.id for chunk in chunks_for(item.id)]
    assert "INDEXED" in runner.invoke(args=["process-document", str(item.id)]).output
    assert [chunk.id for chunk in chunks_for(item.id)] == before
    missing = runner.invoke(args=["process-document", "2147483647"])
    assert missing.exit_code != 0 and "Traceback" not in missing.output


@pytest.mark.parametrize("query", ["", "q=", "q=%20%20", "q=" + "x" * 201, "q=bad%00text",
    "q=coverage&limit=0", "q=coverage&limit=21", "q=coverage&limit=1.2", "q=coverage&limit=-1",
    "q=coverage&limit=", "q=one&q=two", "q=coverage&limit=1&limit=2", "q=coverage&unknown=1"])
def test_search_validation(client, query):
    response = client.get("/api/documents/search?" + query)
    assert response.status_code == 400 and response.is_json


def test_punctuation_only_search_and_static_route(client):
    assert client.get("/api/documents/search?q=!!!").get_json() == {"query": "!!!", "results": []}


@pytest.mark.parametrize("query,limit", [("coverage", 10), ("annual checkups", 20), ("nonexistent", 1)])
def test_search_api_maps_database_results(client, monkeypatch, query, limit):
    results = [] if query == "nonexistent" else [{"document_id": 1, "document_title": "Fictional policy",
        "chunk_id": 5, "page_number": 2, "text": "Synthetic matching passage.", "score": 0.42}]
    execute = Mock(return_value=results)
    monkeypatch.setattr(document_search, "execute_search", execute)
    response = client.get("/api/documents/search", query_string={"q": " " + query + " ", "limit": limit})
    assert response.status_code == 200 and response.get_json() == {"query": query, "results": results}
    execute.assert_called_once_with(query, limit)


def test_search_sql_is_parameterized_ranked_indexed_and_deterministic():
    statement = document_search.search_statement()
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "plainto_tsquery('english'::regconfig, %(query)s)" in sql
    assert "@@" in sql and "ts_rank_cd" in sql
    assert "ORDER BY score DESC, documents.id ASC, document_chunks.chunk_index ASC, document_chunks.id ASC" in sql
    assert "LIMIT %(result_limit)s" in sql
    assert "INDEXED" in statement.compile().params.values()
    malicious = "coverage'; DROP TABLE documents; --"
    bound = statement.params(query=malicious, result_limit=10).compile(dialect=postgresql.dialect())
    assert malicious not in str(bound) and bound.params["query"] == malicious
    index = next(index for index in DocumentChunk.__table__.indexes if index.name == "ix_document_chunks_search")
    assert index.dialect_options["postgresql"]["using"] == "gin"


def test_search_errors_are_sanitized(client, monkeypatch, caplog):
    monkeypatch.setattr(document_search, "execute_search", Mock(side_effect=OperationalError("SECRET TEXT", {}, Exception("secret path"))))
    response = client.get("/api/documents/search?q=coverage")
    assert response.status_code == 500 and "secret" not in response.get_data(as_text=True).lower() + caplog.text.lower()


def test_postgres_only_ranking_has_no_silent_sqlite_fallback(client):
    assert client.get("/api/documents/search?q=coverage").status_code == 500


def test_extraction_timeout_and_diagnostics_are_sanitized(tmp_path, monkeypatch):
    path = tmp_path / "fictional.pdf"
    path.write_bytes(make_pdf("Fictional"))
    monkeypatch.setattr(pdf_extraction.subprocess, "run", Mock(side_effect=TimeoutExpired("secret path", 10)))
    with pytest.raises(ExtractionError) as error:
        extract_chunks(path)
    assert "secret" not in str(error.value)


def test_hard_memory_quota_in_child():
    # The actual allocation is rejected in a disposable process, never in pytest.
    import subprocess

    program = ("from app.pdf_limits import enforce_limits, MEMORY_LIMIT; enforce_limits(); "
               "exec('try:\\n bytearray(MEMORY_LIMIT + 1)\\nexcept MemoryError:\\n print(\"bounded\")')")
    result = subprocess.run([sys.executable, "-c", program], cwd=BACKEND_DIRECTORY,
                            capture_output=True, timeout=10)
    assert result.returncode == 0 and result.stdout.strip() == b"bounded"


def test_additive_chunk_migration_preserves_existing_metadata(app):
    downgrade(directory=str(BACKEND_DIRECTORY / "migrations"), revision="7b21d4a90c6f")
    db.session.execute(text("INSERT INTO documents (title, original_filename, stored_filename, content_type, file_size) "
                            "VALUES ('Fictional sentinel', 'sentinel.pdf', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf', 'application/pdf', 1)"))
    db.session.commit()
    upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
    item = db.session.scalar(select(Document).where(Document.title == "Fictional sentinel"))
    assert item.processing_status == "UNPROCESSED" and item.original_filename == "sentinel.pdf"
    assert inspect(db.engine).get_foreign_keys("document_chunks")[0]["options"]["ondelete"] == "CASCADE"
    with db.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), db.metadata) == []


@pytest.mark.parametrize("changes", [{"page_number": 0}, {"chunk_index": -1}, {"content": ""}, {"content": "x" * 1201}])
def test_chunk_database_constraints(app, changes):
    item = unprocessed_document(app, make_pdf("Fictional"))
    fields = {"document_id": item.id, "page_number": 1, "chunk_index": 0, "content": "Synthetic coverage", **changes}
    db.session.add(DocumentChunk(**fields))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_unique_order_constraint(app):
    item = unprocessed_document(app, make_pdf("Fictional"))
    for page in (1, 2):
        db.session.add(DocumentChunk(document_id=item.id, page_number=page, chunk_index=0, content="Fictional"))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()
