"""Offline Supabase REST integration; only disposable SQLite and synthetic PDFs."""
from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app import create_app, documents, document_processing, document_search, gemini
from app.extensions import db
from app.models import Document, DocumentChunk
from app.pdf_storage import SupabasePDFStorage, StorageError, retrieve_pdf, MAX_BYTES
from test_documents import app, client, pdf, upload  # Reuse real auth/migrations/PDF fixtures.

SETTINGS = {"PDF_STORAGE_BACKEND": "supabase", "SUPABASE_URL": "https://synthetic.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_synthetic_offline_test_only", "SUPABASE_STORAGE_BUCKET": "private-pdfs"}
REAL_CLIENT = httpx.Client


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(gemini.genai, "Client", Mock(side_effect=AssertionError("No live Gemini")))
    monkeypatch.setattr(httpx, "Client", Mock(side_effect=AssertionError("No live HTTP")))


@pytest.fixture()
def cloud(app, monkeypatch):
    app.config.update(SETTINGS)
    state = SimpleNamespace(objects={}, requests=[], public=False, fail=None, paths=[], response=None)

    def handle(request):
        state.requests.append(request)
        assert request.headers["apikey"] == SETTINGS["SUPABASE_SECRET_KEY"]
        assert "authorization" not in request.headers
        assert request.url.scheme == "https"
        assert "/public/" not in request.url.path
        if request.url.path.endswith("/bucket/private-pdfs"):
            return httpx.Response(200, json={"id": "private-pdfs", "public": state.public})
        if state.fail == request.method:
            raise httpx.ReadTimeout("synthetic provider secret diagnostics")
        key = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST":
            assert request.headers["x-upsert"] == "false"
            assert request.headers["content-type"] == "application/pdf"
            if key in state.objects:
                return httpx.Response(409, json={"error": "synthetic provider secret"})
            state.objects[key] = request.content
            return httpx.Response(200, json={"Key": key})
        if request.method == "GET":
            if state.response is not None:
                return state.response
            if key not in state.objects:
                return httpx.Response(404)
            return httpx.Response(200, content=state.objects[key])
        if request.method == "DELETE":
            keys = json.loads(request.content)["prefixes"]
            assert len(keys) == 1
            state.objects.pop(keys[0], None)
            return httpx.Response(200, json=[])
        raise AssertionError("Unexpected request")

    def factory(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["trust_env"] is False
        assert kwargs["timeout"].connect == 5
        assert kwargs["timeout"].read == 10
        return REAL_CLIENT(**kwargs, transport=httpx.MockTransport(handle))

    monkeypatch.setattr(httpx, "Client", factory)
    return state


@pytest.mark.parametrize("settings", [
    {"PDF_STORAGE_BACKEND": "wrong"},
    {**SETTINGS, "SUPABASE_SECRET_KEY": ""},
    {**SETTINGS, "SUPABASE_SECRET_KEY": "sb_publishable_synthetic_not_privileged"},
    {**SETTINGS, "SUPABASE_URL": "http://synthetic.supabase.co"},
    {**SETTINGS, "SUPABASE_URL": "https://synthetic.supabase.co/redirect"},
    {**SETTINGS, "SUPABASE_URL": "https://user:pass@synthetic.supabase.co"},
    {**SETTINGS, "SUPABASE_STORAGE_BUCKET": "../private"},
    {**SETTINGS, "SUPABASE_STORAGE_BUCKET": ""},
])
def test_configuration_fails_closed(settings):
    with pytest.raises(RuntimeError) as error:
        create_app(settings)
    assert SETTINGS["SUPABASE_SECRET_KEY"] not in str(error.value)


def test_valid_modes_need_no_network():
    assert create_app({}).config["PDF_STORAGE_BACKEND"] == "local"
    assert create_app(SETTINGS).config["PDF_STORAGE_BACKEND"] == "supabase"


def test_local_remains_default(app, client, pdf):
    response = upload(client, pdf)
    assert response.status_code == 201
    item = db.session.get(Document, response.json["data"]["id"])
    with retrieve_pdf(item.stored_filename) as path:
        assert path.read_bytes() == pdf
    assert client.delete(f"/api/documents/{item.id}").status_code == 204
    assert not path.exists()


def test_supabase_upload_process_and_delete(app, client, pdf, cloud):
    response = upload(client, pdf)
    assert response.status_code == 201
    assert response.json["data"]["processing_status"] == "NO_TEXT"
    item = db.session.get(Document, response.json["data"]["id"])
    key, identifier = item.stored_filename, item.id
    assert cloud.objects[key] == pdf
    assert documents.STORED_NAME.fullmatch(key)
    assert set(response.json["data"]) == {"id", "title", "original_filename", "file_size", "content_type", "created_at", "processing_status"}
    assert "supabase" not in response.get_data(as_text=True)
    assert not Path(app.config["DOCUMENT_UPLOAD_DIR"]).exists()
    assert client.delete(f"/api/documents/{identifier}").status_code == 204
    assert key not in cloud.objects
    assert db.session.get(Document, identifier) is None


def test_invalid_pdf_never_touches_storage(client, cloud):
    assert upload(client, b"not a PDF").status_code == 400
    assert cloud.requests == []


def test_keys_are_unique_and_collision_never_overwrites(client, pdf, cloud, monkeypatch):
    assert upload(client, pdf).status_code == 201
    first = next(iter(cloud.objects))
    assert upload(client, pdf).status_code == 201
    assert len(cloud.objects) == 2
    monkeypatch.setattr(documents, "uuid4", lambda: SimpleNamespace(hex=first[:-4]))
    assert upload(client, pdf).status_code == 500
    assert cloud.objects[first] == pdf
    assert len(cloud.objects) == 2


@pytest.mark.parametrize("key", ["../a.pdf", "a/b.pdf", "https://public/a.pdf", "*", "A" * 32 + ".pdf"])
def test_unsafe_keys_rejected_before_network(app, cloud, key):
    for operation in (lambda: SupabasePDFStorage().save(key, b"x"),
                      lambda: SupabasePDFStorage().retrieve(key), lambda: SupabasePDFStorage().delete(key)):
        with pytest.raises(StorageError):
            operation()
    assert not cloud.requests


@pytest.mark.parametrize("method", ["POST", "GET"])
def test_upload_or_retrieval_failure_rolls_back(client, app, pdf, cloud, method, caplog):
    cloud.fail = method
    result = upload(client, pdf)
    assert result.status_code == 500
    assert list(db.session.scalars(select(Document))) == []
    assert cloud.objects == {}
    assert not Path(app.config["DOCUMENT_UPLOAD_DIR"]).exists()
    assert "synthetic provider secret" not in result.get_data(as_text=True) + caplog.text


def test_retrieve_private_tempfile_cleanup_even_on_processing_failure(app, cloud):
    key = "a" * 32 + ".pdf"
    cloud.objects[key] = b"synthetic"
    with pytest.raises(ValueError):
        with retrieve_pdf(key) as path:
            assert path.read_bytes() == b"synthetic"
            raise ValueError("parser failed")
    assert not path.exists()
    assert not path.parent.exists()


@pytest.mark.parametrize("kind", ["missing", "oversized", "empty", "redirect"])
def test_retrieval_rejects_bad_responses(app, cloud, kind):
    key = "a" * 32 + ".pdf"
    if kind == "oversized":
        cloud.objects[key] = b"x" * (MAX_BYTES + 1)
    elif kind == "empty":
        cloud.objects[key] = b""
    elif kind == "redirect":
        cloud.response = httpx.Response(302, headers={"Location": "https://evil.invalid"})
    with pytest.raises(StorageError):
        with retrieve_pdf(key):
            pytest.fail("Bad response must not reach parser")


def test_public_bucket_fails_before_upload(client, pdf, cloud):
    cloud.public = True
    assert upload(client, pdf).status_code == 500
    assert not cloud.objects
    assert all("/bucket/" in r.url.path for r in cloud.requests)


def test_parser_failure_keeps_durable_pdf_and_marks_failed(client, pdf, cloud, monkeypatch):
    monkeypatch.setattr(document_processing, "extract_chunks", Mock(side_effect=document_processing.ExtractionError("bad")))
    result = upload(client, pdf)
    assert result.status_code == 201
    assert result.json["data"]["processing_status"] == "FAILED"
    assert len(cloud.objects) == 1


def test_database_failure_compensates_object(client, pdf, cloud, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "flush", Mock(side_effect=OperationalError("synthetic", {}, Exception())))
        assert upload(client, pdf).status_code == 500
    assert cloud.objects == {}
    assert list(db.session.scalars(select(Document))) == []


def test_remote_delete_failure_reports_error_and_retains_object_for_reconciliation(client, pdf, cloud, caplog):
    result = upload(client, pdf)
    identifier = result.json["data"]["id"]
    key = next(iter(cloud.objects))
    cloud.fail = "DELETE"
    assert client.delete(f"/api/documents/{identifier}").status_code == 500
    assert db.session.get(Document, identifier) is None
    assert key in cloud.objects
    assert key in caplog.text
    assert "synthetic provider secret" not in caplog.text


def test_missing_object_delete_is_idempotent(client, pdf, cloud):
    identifier = upload(client, pdf).json["data"]["id"]
    cloud.objects.clear()
    assert client.delete(f"/api/documents/{identifier}").status_code == 204


def test_database_delete_failure_preserves_remote_object(client, pdf, cloud, monkeypatch):
    identifier = upload(client, pdf).json["data"]["id"]
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", Mock(side_effect=OperationalError("synthetic", {}, Exception())))
        assert client.delete(f"/api/documents/{identifier}").status_code == 500
    assert db.session.get(Document, identifier) is not None
    assert len(cloud.objects) == 1


def test_auth_csrf_and_invalid_document_ids_do_not_touch_remote(app, client, cloud):
    guest = app.test_client()
    assert guest.delete("/api/documents/1").status_code == 401
    assert client.delete("/api/documents/1", headers={"X-CSRF-Token": "invalid"}).status_code == 403
    assert client.delete("/api/documents/../bad").status_code == 404
    assert not cloud.requests


def test_remote_text_processing_and_ai_citations_remain_stable(app, client, cloud, monkeypatch):
    import pymupdf
    from test_ai import response, model_json
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((30, 50), "Fictional claim documents require a receipt.")
        content = pdf.tobytes()
    result = upload(client, content)
    assert result.status_code == 201
    identifier = result.json["data"]["id"]
    item = db.session.get(Document, identifier)
    chunk = db.session.scalar(select(DocumentChunk).where(DocumentChunk.document_id == identifier))
    assert item.processing_status == "INDEXED"
    row = {"document_id": identifier, "document_title": item.title, "page_number": chunk.page_number,
           "chunk_id": chunk.id, "text": chunk.content}
    monkeypatch.setattr(document_search, "execute_search", Mock(return_value=[row]))
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=factory.return_value)
    factory.return_value.__exit__ = Mock()
    factory.return_value.models.generate_content.return_value = response(model_json(row))
    monkeypatch.setattr(gemini.genai, "Client", factory)
    app.config["GEMINI_API_KEY"] = "synthetic-offline-key"
    answer = client.post("/api/ai/ask", json={"question": "What claim documents?"})
    assert answer.status_code == 200
    assert answer.json["grounded"] is True
    assert answer.json["sources"] == [{key: row[key] for key in ("document_id", "document_title", "page_number", "chunk_id")}]
    assert set(answer.json) == {"answer", "sources", "grounded"}
    assert client.delete(f"/api/documents/{identifier}").status_code == 204
    assert list(db.session.scalars(select(DocumentChunk))) == []


def test_missing_supabase_configuration_never_falls_back():
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        create_app({"PDF_STORAGE_BACKEND": "supabase"})


def test_environment_selects_storage_without_reading_local_env(monkeypatch, tmp_path):
    from app import config
    monkeypatch.setattr(config, "BACKEND_DIRECTORY", tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://synthetic@localhost/test")
    for key, value in SETTINGS.items():
        monkeypatch.setenv(key, value)
    settings = config.local_configuration()
    assert all(settings[key] == value for key, value in SETTINGS.items())


def test_lost_upload_commit_ack_preserves_object_and_metadata(client, pdf, cloud, monkeypatch):
    commit = db.session.commit

    def uncertain():
        commit()
        raise OperationalError("synthetic lost acknowledgement", {}, Exception())

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", uncertain)
        assert upload(client, pdf).status_code == 500
    assert len(cloud.objects) == 1
    assert len(list(db.session.scalars(select(Document)))) == 1


def test_lost_delete_commit_ack_finishes_remote_purge(client, pdf, cloud, monkeypatch):
    identifier = upload(client, pdf).json["data"]["id"]
    commit = db.session.commit

    def uncertain():
        commit()
        raise OperationalError("synthetic lost acknowledgement", {}, Exception())

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", uncertain)
        assert client.delete(f"/api/documents/{identifier}").status_code == 204
    assert not cloud.objects


def test_uncertain_delete_commit_keeps_only_remote_copy(client, pdf, cloud, monkeypatch):
    identifier = upload(client, pdf).json["data"]["id"]
    commit = db.session.commit

    def uncertain():
        commit()
        # Verification query is unavailable after the commit acknowledgement.
        monkeypatch.setattr(db.session, "scalar", Mock(side_effect=OperationalError("synthetic", {}, Exception())))
        raise OperationalError("synthetic", {}, Exception())

    with monkeypatch.context() as patch:
        patch.setattr(db.session, "commit", uncertain)
        assert client.delete(f"/api/documents/{identifier}").status_code == 500
    assert len(cloud.objects) == 1


def test_unconfirmed_upload_keeps_object_and_logs_recovery_key(client, pdf, cloud, monkeypatch, caplog):
    save = SupabasePDFStorage.save

    def uncertain(self, key, content):
        save(self, key, content)
        raise StorageError("Private PDF storage operation failed.")

    monkeypatch.setattr(SupabasePDFStorage, "save", uncertain)
    assert upload(client, pdf).status_code == 500
    assert list(db.session.scalars(select(Document))) == []
    assert next(iter(cloud.objects)) in caplog.text


def test_failed_compensation_is_reported_for_reconciliation(client, pdf, cloud, monkeypatch, caplog):
    cloud.fail = "DELETE"
    with monkeypatch.context() as patch:
        patch.setattr(db.session, "flush", Mock(side_effect=OperationalError("synthetic", {}, Exception())))
        assert upload(client, pdf).status_code == 500
    assert next(iter(cloud.objects)) in caplog.text
    assert list(db.session.scalars(select(Document))) == []
