from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from subprocess import TimeoutExpired
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from pypdf import PdfWriter
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from werkzeug.datastructures import MultiDict

from app import create_app, documents
from app.config import BACKEND_DIRECTORY, local_configuration
from app.extensions import db
from app.models import Document, SupportRequest


@pytest.fixture()
def app(tmp_path):
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'documents.sqlite').as_posix()}",
        "DOCUMENT_UPLOAD_DIR": str(tmp_path / "private_uploads"),
    })
    with application.app_context():
        upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
        # Alembic's default logging config disables existing application loggers.
        application.logger.disabled = False
        yield application
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": "Fictional synthetic document"})
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def upload(client, pdf, filename="fictional.pdf", **fields):
    return client.post("/api/documents", data={
        # Properly escape quoted multipart filename backslashes on the wire.
        "file": (BytesIO(pdf), filename.replace("\\", "\\\\")), **fields,
    }, content_type="multipart/form-data")


def create(client, pdf, **fields):
    response = upload(client, pdf, **fields)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["data"]


def entries(app):
    root = Path(app.config["DOCUMENT_UPLOAD_DIR"])
    return list(root.iterdir()) if root.exists() else []


def failure(*args, **kwargs):
    raise OperationalError("secret SQL", {}, Exception("secret password"))


def test_valid_upload_metadata_and_stored_bytes(app, client, pdf):
    item = create(client, pdf, title="  Fictional benefits  ")
    assert set(item) == {"id", "title", "original_filename", "file_size", "content_type", "created_at", "processing_status"}
    assert item["processing_status"] == "NO_TEXT"
    assert item["title"] == "Fictional benefits"
    assert item["original_filename"] == "fictional.pdf"
    assert item["file_size"] == len(pdf)
    assert item["content_type"] == "application/pdf"
    assert datetime.fromisoformat(item["created_at"]).utcoffset() == timedelta(0)
    row = db.session.get(Document, item["id"])
    assert documents.STORED_NAME.fullmatch(row.stored_filename)
    assert documents.document_path(row.stored_filename).read_bytes() == pdf
    assert client.get(f"/api/documents/{item['id']}").get_json() == {"data": item}
    assert client.get("/api/documents").get_json()["data"] == [item]


def test_default_title_and_case_insensitive_extension(client, pdf):
    assert create(client, pdf, filename="Fictional Benefits.PDF")["title"] == "Fictional Benefits"


def test_client_mime_is_not_trusted(client, pdf):
    response = client.post("/api/documents", data={"file": (BytesIO(pdf), "fictional.pdf", "text/plain")})
    assert response.status_code == 201
    assert response.get_json()["data"]["content_type"] == "application/pdf"


@pytest.mark.parametrize("filename", ["fictional.txt", "fictional.pdf.exe", "no_extension", "", "a" * 252 + ".pdf"])
def test_invalid_filenames(app, client, pdf, filename):
    assert upload(client, pdf, filename).status_code == 400
    assert not entries(app)
    assert client.get("/api/documents").get_json()["total"] == 0


@pytest.mark.parametrize("filename", ["../fictional.pdf", "..\\fictional.pdf", "/tmp/fictional.pdf",
    "C:\\fakepath\\fictional.pdf", "C:fictional.pdf", "fictional.pdf:stream.pdf", "bad\x00.pdf"])
def test_path_traversal_uploads_never_write(app, client, pdf, filename):
    assert upload(client, pdf, filename).status_code == 400
    assert not entries(app)


@pytest.mark.parametrize("content", [b"", b"plain text", b"%PDF-1.4\nnot a PDF\n%%EOF",
    b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"])
def test_empty_fake_or_invalid_structure(app, client, content):
    assert upload(client, content).status_code == 400
    assert not entries(app)


def test_truncated_pdf_and_fake_mime(client, pdf):
    assert upload(client, pdf[:-15]).status_code == 400
    assert upload(client, b"<html>fictional</html>").status_code == 400


def test_encrypted_and_pageless_pdf(client):
    for encrypted in (False, True):
        writer = PdfWriter()
        if encrypted:
            writer.add_blank_page(width=72, height=72)
            writer.encrypt("fictional-only")
        stream = BytesIO()
        writer.write(stream)
        assert upload(client, stream.getvalue()).status_code == 400


@pytest.mark.parametrize("data", [{}, {"title": "fictional"}])
def test_missing_file(client, data):
    response = client.post("/api/documents", data=data, content_type="multipart/form-data")
    assert response.status_code == 400
    assert "file" in response.get_json()["details"]


def test_wrong_request_type(client):
    assert client.post("/api/documents", json={"file": "fictional.pdf"}).status_code == 400


@pytest.mark.parametrize("title", ["", " \t ", "x" * 201, "bad\x00title", "bad\ntitle"])
def test_invalid_title(client, pdf, title):
    response = upload(client, pdf, title=title)
    assert response.status_code == 400
    assert "title" in response.get_json()["details"]


def test_title_character_limit(client, pdf):
    assert create(client, pdf, title="界" * 200)["title"] == "界" * 200
    assert upload(client, pdf, filename="a" * 201 + ".pdf").status_code == 400


def test_duplicate_or_unknown_parts(client, pdf):
    for data in (
        MultiDict([("file", (BytesIO(pdf), "one.pdf")), ("file", (BytesIO(pdf), "two.pdf"))]),
        MultiDict([("file", (BytesIO(pdf), "one.pdf")), ("title", "one"), ("title", "two")]),
        {"file": (BytesIO(pdf), "one.pdf"), "stored_filename": "arbitrary.pdf"},
        {"file": (BytesIO(pdf), "one.pdf"), "other": (BytesIO(pdf), "two.pdf")},
    ):
        assert client.post("/api/documents", data=data).status_code == 400


def test_exact_size_limit_with_multipart_allowance(app, client, pdf):
    # PDF whitespace after EOF is permitted; exact 5 MiB includes the whole file.
    content = pdf + b" " * (documents.MAX_FILE_SIZE - len(pdf))
    assert upload(client, content).status_code == 201
    assert upload(client, content + b" ").status_code == 413
    assert upload(client, b"x" * (documents.MAX_REQUEST_SIZE + 1)).status_code == 413
    assert len(entries(app)) == 1


def test_parser_timeout_diagnostics_are_sanitized(app, client, pdf, monkeypatch, caplog):
    monkeypatch.setattr(documents.subprocess, "run", Mock(side_effect=TimeoutExpired("secret", 5)))
    response = upload(client, pdf)
    assert response.status_code == 400
    assert "secret" not in response.get_data(as_text=True) + caplog.text
    assert not entries(app)


def test_parser_startup_failure_is_server_error(client, pdf, monkeypatch):
    monkeypatch.setattr(documents.subprocess, "run", Mock(side_effect=OSError("secret path")))
    response = upload(client, pdf)
    assert response.status_code == 500
    assert "secret" not in response.get_data(as_text=True)


def test_duplicate_original_names_have_unique_internal_names(app, client, pdf):
    items = [create(client, pdf) for _ in range(2)]
    rows = db.session.scalars(select(Document)).all()
    assert items[0]["original_filename"] == items[1]["original_filename"]
    assert len({row.stored_filename for row in rows}) == 2
    assert len(entries(app)) == 2


def test_collision_does_not_overwrite_existing_file(app, client, pdf, monkeypatch):
    first = create(client, pdf)
    row = db.session.get(Document, first["id"])
    name = row.stored_filename
    monkeypatch.setattr(documents, "uuid4", lambda: SimpleNamespace(hex=name[:-4]))
    assert upload(client, pdf, title="Different fictional file").status_code == 500
    assert documents.document_path(name).read_bytes() == pdf
    assert client.get("/api/documents").get_json()["total"] == 1


def test_empty_and_out_of_range_pages(client):
    expected = {"data": [], "page": 1, "page_size": 20, "total": 0, "total_pages": 0}
    assert client.get("/api/documents").get_json() == expected
    assert client.get("/api/documents?page=50").get_json() == {**expected, "page": 50}


def test_newest_first_pagination_and_id_tie_break(client, pdf):
    ids = [create(client, pdf, title=f"Fictional {i}")["id"] for i in range(3)]
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for row in db.session.scalars(select(Document)).all():
        row.created_at = timestamp
    db.session.commit()
    first = client.get("/api/documents?page_size=2").get_json()
    assert [row["id"] for row in first["data"]] == ids[::-1][:2]
    assert first["total"] == 3 and first["total_pages"] == 2
    assert client.get("/api/documents?page_size=2&page=2").get_json()["data"][0]["id"] == ids[0]
    db.session.get(Document, ids[0]).created_at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    db.session.commit()
    assert client.get("/api/documents").get_json()["data"][0]["id"] == ids[0]


@pytest.mark.parametrize("query", ["page=0", "page=-1", "page=1.5", "page=2147483648", "page_size=101",
    "page_size=0", "page_size=", "page=1&page=2", "q=fictional", "stored_filename=x"])
def test_invalid_pagination(client, query):
    assert client.get("/api/documents?" + query).status_code == 400


@pytest.mark.parametrize("document_id", ["9999", "0", "-1", "abc", "2147483648", "999999999999999999999"])
@pytest.mark.parametrize("method", ["get", "delete"])
def test_missing_or_malformed_ids(client, method, document_id):
    response = getattr(client, method)(f"/api/documents/{document_id}")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Document not found."}


def test_delete_removes_only_target(app, client, pdf):
    first, second = create(client, pdf), create(client, pdf)
    second_path = documents.document_path(db.session.get(Document, second["id"]).stored_filename)
    response = client.delete(f"/api/documents/{first['id']}")
    assert response.status_code == 204 and response.data == b""
    assert client.get(f"/api/documents/{first['id']}").status_code == 404
    assert second_path.read_bytes() == pdf
    assert entries(app) == [second_path]


def test_delete_missing_file_removes_stale_metadata(client, pdf):
    item = create(client, pdf)
    documents.document_path(db.session.get(Document, item["id"]).stored_filename).unlink()
    assert client.delete(f"/api/documents/{item['id']}").status_code == 204


@pytest.mark.parametrize("stored", ["../outside.pdf", "..\\outside.pdf", "/tmp/outside.pdf", "C:\\outside.pdf"])
def test_corrupt_storage_identifier_cannot_delete_external_file(app, client, tmp_path, stored):
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"fictional external file")
    row = Document(title="fictional", original_filename="fictional.pdf", stored_filename=stored,
                   content_type="application/pdf", file_size=1)
    db.session.add(row)
    db.session.commit()
    assert client.delete(f"/api/documents/{row.id}").status_code == 500
    assert outside.read_bytes() == b"fictional external file"
    assert db.session.get(Document, row.id) is not None


@pytest.mark.parametrize("operation", ["upload", "delete"])
def test_database_failure_restores_consistency(app, client, pdf, monkeypatch, caplog, operation):
    original = create(client, pdf)
    original_path = entries(app)[0]
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", failure)
        response = (upload(client, pdf) if operation == "upload"
                    else client.delete(f"/api/documents/{original['id']}"))
    assert response.status_code == 500
    assert "secret" not in response.get_data(as_text=True) + caplog.text
    assert client.get("/api/documents").get_json()["data"] == [original]
    assert entries(app) == [original_path]
    assert original_path.read_bytes() == pdf


def test_flush_failure_cleans_only_new_upload(app, client, pdf, monkeypatch):
    original = create(client, pdf)
    paths = entries(app)
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "flush", failure)
        assert upload(client, pdf).status_code == 500
    assert entries(app) == paths
    assert client.get("/api/documents").get_json()["data"] == [original]


def test_lost_commit_acknowledgement_preserves_persisted_upload(app, client, pdf, monkeypatch):
    real_commit = db.session.commit

    def committed_but_acknowledgement_lost():
        real_commit()
        failure()

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", committed_but_acknowledgement_lost)
        assert upload(client, pdf).status_code == 500
    assert client.get("/api/documents").get_json()["total"] == 1
    assert len(entries(app)) == 1 and entries(app)[0].read_bytes() == pdf


def test_lost_delete_commit_acknowledgement_finishes_purge(app, client, pdf, monkeypatch):
    item = create(client, pdf)
    real_commit = db.session.commit

    def committed_but_acknowledgement_lost():
        real_commit()
        failure()

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", committed_but_acknowledgement_lost)
        assert client.delete(f"/api/documents/{item['id']}").status_code == 204
    assert client.get("/api/documents").get_json()["total"] == 0
    assert not entries(app)


def test_delete_staging_collision_preserves_existing_directory(app, client, pdf, monkeypatch):
    item = create(client, pdf)
    root = Path(app.config["DOCUMENT_UPLOAD_DIR"])
    collision = root / (f".delete-{item['id']}-" + "a" * 32)
    collision.mkdir()
    with monkeypatch.context() as patch:
        patch.setattr(documents, "uuid4", lambda: SimpleNamespace(hex="a" * 32))
        assert client.delete(f"/api/documents/{item['id']}").status_code == 500
    assert collision.is_dir()
    assert client.get(f"/api/documents/{item['id']}").status_code == 200
    assert len(entries(app)) == 2


def test_unverifiable_upload_commit_keeps_bytes_for_recovery(app, client, pdf, monkeypatch, caplog):
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", failure)
        patch.setattr(db.session, "scalar", failure)
        assert upload(client, pdf).status_code == 500
    assert len(entries(app)) == 1 and entries(app)[0].read_bytes() == pdf
    assert client.get("/api/documents").get_json()["total"] == 0
    assert "commit uncertain" in caplog.text
    assert "secret" not in caplog.text


def test_unverifiable_delete_commit_preserves_backup(app, client, pdf, monkeypatch, caplog):
    item = create(client, pdf)
    real_scalar = db.session.scalar
    calls = 0

    def scalar(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls > 1:
            failure()
        return real_scalar(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", failure)
        patch.setattr(db.session, "scalar", scalar)
        assert client.delete(f"/api/documents/{item['id']}").status_code == 500
    assert client.get(f"/api/documents/{item['id']}").status_code == 200
    assert len(entries(app)) == 1
    assert next(entries(app)[0].iterdir()).read_bytes() == pdf
    assert "commit uncertain" in caplog.text
    assert "secret" not in caplog.text


def test_partial_write_is_cleaned_up(app, client, pdf, monkeypatch):
    real_open = Path.open

    class PartialWrite:
        def __init__(self, path):
            self.handle = real_open(path, "xb")

        def __enter__(self):
            return self

        def write(self, content):
            self.handle.write(content[:10])
            raise OSError("secret disk failure")

        def __exit__(self, *args):
            self.handle.close()

    with monkeypatch.context() as patch:
        patch.setattr(Path, "open", lambda path, mode: PartialWrite(path))
        assert upload(client, pdf).status_code == 500
    assert not entries(app)
    assert client.get("/api/documents").get_json()["total"] == 0


def test_missing_storage_directory_error_is_sanitized(app, client, pdf, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(Path, "mkdir", Mock(side_effect=PermissionError("secret path")))
        response = upload(client, pdf)
    assert response.status_code == 500 and "secret" not in response.get_data(as_text=True)
    assert not entries(app)


@pytest.mark.parametrize("operation", ["upload", "delete"])
def test_storage_failure_preserves_existing_document(app, client, pdf, monkeypatch, operation):
    original = create(client, pdf)
    paths = entries(app)
    with monkeypatch.context() as patch:
        if operation == "upload":
            patch.setattr(Path, "open", Mock(side_effect=PermissionError("secret path")))
            response = upload(client, pdf)
        else:
            patch.setattr(Path, "rename", Mock(side_effect=PermissionError("secret path")))
            response = client.delete(f"/api/documents/{original['id']}")
    assert response.status_code == 500
    assert "secret" not in response.get_data(as_text=True)
    assert entries(app) == paths
    assert paths[0].read_bytes() == pdf
    assert client.get("/api/documents").get_json()["data"] == [original]


def test_failed_final_purge_keeps_isolated_recoverable_file(app, client, pdf, monkeypatch, caplog):
    item = create(client, pdf)
    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", Mock(side_effect=PermissionError("secret path")))
        assert client.delete(f"/api/documents/{item['id']}").status_code == 204
    assert client.get(f"/api/documents/{item['id']}").status_code == 404
    tombstones = entries(app)
    assert len(tombstones) == 1 and tombstones[0].name.startswith(f".delete-{item['id']}-")
    assert len(list(tombstones[0].iterdir())) == 1
    assert "staged file purge needs reconciliation" in caplog.text
    assert "secret" not in caplog.text


@pytest.mark.parametrize("route", ["/api/documents", "/api/documents/1"])
def test_read_database_errors_are_sanitized(client, monkeypatch, caplog, route):
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "scalar", failure)
        response = client.get(route)
    assert response.status_code == 500
    assert "secret" not in response.get_data(as_text=True) + caplog.text


def test_public_storage_configuration_rejected(app):
    for root in (BACKEND_DIRECTORY.parent / "frontend" / "public",
                 BACKEND_DIRECTORY.parent / "frontend" / "dist",
                 BACKEND_DIRECTORY.parent / "frontend" / "src", Path(app.static_folder)):
        app.config["DOCUMENT_UPLOAD_DIR"] = str(root / "documents")
        with pytest.raises(OSError):
            documents.storage_directory()


def test_relative_storage_and_environment_configuration(app, monkeypatch):
    app.config["DOCUMENT_UPLOAD_DIR"] = "instance/fictional"
    assert documents.storage_directory() == (BACKEND_DIRECTORY / "instance/fictional").resolve()
    monkeypatch.setenv("DOCUMENT_UPLOAD_DIR", "instance/custom")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test@localhost:7498/healthcareassist_ai")
    assert local_configuration()["DOCUMENT_UPLOAD_DIR"] == "instance/custom"


def test_symlink_entries_are_rejected(app, client, pdf, tmp_path, monkeypatch):
    # Portable safety assertion even on Windows without symlink creation privilege.
    item = create(client, pdf)
    path = entries(app)[0]
    with monkeypatch.context() as patch:
        patch.setattr(Path, "is_symlink", lambda self: self == path)
        assert client.delete(f"/api/documents/{item['id']}").status_code == 500
    assert path.read_bytes() == pdf


def test_document_migration_is_additive_and_matches_model(app):
    with db.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), db.metadata) == []
    columns = {column["name"]: column for column in inspect(db.engine).get_columns("documents")}
    assert set(columns) == {"id", "title", "original_filename", "stored_filename", "content_type", "file_size", "created_at", "processing_status"}
    request = SupportRequest(title="Fictional migration sentinel", description="Synthetic only")
    db.session.add(request)
    db.session.commit()
    request_id = request.id
    downgrade(directory=str(BACKEND_DIRECTORY / "migrations"), revision="3db23834e8ac")
    assert "documents" not in inspect(db.engine).get_table_names()
    assert db.session.get(SupportRequest, request_id).title == "Fictional migration sentinel"
    upgrade(directory=str(BACKEND_DIRECTORY / "migrations"))
    assert db.session.scalar(text("SELECT version_num FROM alembic_version")) == "9d82b6f31a04"
    assert db.session.get(SupportRequest, request_id).title == "Fictional migration sentinel"


@pytest.mark.parametrize("field,value", [("title", ""), ("title", "x" * 201), ("file_size", 0), ("file_size", 5242881)])
def test_document_database_constraints(app, field, value):
    fields = dict(title="Fictional", original_filename="fictional.pdf", stored_filename="a" * 32 + ".pdf",
                  content_type="application/pdf", file_size=1)
    fields[field] = value
    db.session.add(Document(**fields))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()
