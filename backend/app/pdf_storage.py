"""Small private PDF storage boundary. Imported by the factory, never workers."""

from contextlib import contextmanager
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import time

from flask import current_app

MAX_BYTES = 5 * 1024 * 1024
KEY = re.compile(r"[0-9a-f]{32}\.pdf")


class StorageError(OSError):
    """Sanitized storage failure, without provider diagnostics or credentials."""


def validate_key(key):
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise StorageError("Invalid internal storage identifier.")
    return key


def validate_configuration(config):
    backend = config.get("PDF_STORAGE_BACKEND", "local")
    if backend not in {"local", "supabase"}:
        raise RuntimeError("PDF_STORAGE_BACKEND must be local or supabase.")
    if backend == "local":
        return
    url = config.get("SUPABASE_URL", "")
    key = config.get("SUPABASE_SECRET_KEY", "")
    bucket = config.get("SUPABASE_STORAGE_BUCKET", "")
    # Standard hosted projects only; prevent arbitrary endpoints/credential redirects.
    if not isinstance(url, str) or not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url):
        raise RuntimeError("SUPABASE_URL must be a hosted HTTPS project origin.")
    if not isinstance(key, str) or not re.fullmatch(r"sb_secret_[A-Za-z0-9_-]{16,}", key):
        raise RuntimeError("SUPABASE_SECRET_KEY must be a server-side secret key.")
    if not isinstance(bucket, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", bucket):
        raise RuntimeError("SUPABASE_STORAGE_BUCKET must be a safe private bucket identifier.")


def remote_storage():
    return current_app.config.get("PDF_STORAGE_BACKEND", "local") == "supabase"


class SupabasePDFStorage:
    """Storage REST API over the HTTP client already used by google-genai.

    No retries, redirects, public URLs, auth sessions or Supabase DB features.
    Every operation verifies the bucket is private before accessing an object.
    """

    def __init__(self):
        config = current_app.config
        validate_configuration(config)
        self.url = config["SUPABASE_URL"] + "/storage/v1"
        self.bucket = config["SUPABASE_STORAGE_BUCKET"]
        self.headers = {"apikey": config["SUPABASE_SECRET_KEY"]}

    @contextmanager
    def client(self):
        import httpx

        try:
            # Secret keys authenticate via apikey, not a JWT Authorization header.
            with httpx.Client(headers=self.headers, timeout=httpx.Timeout(10, connect=5),
                              follow_redirects=False, trust_env=False) as client:
                with client.stream("GET", f"{self.url}/bucket/{self.bucket}") as response:
                    self.check(response)
                    data = self.read_bounded(response, 16 * 1024)
                import json
                bucket = json.loads(data)
                if not isinstance(bucket, dict) or bucket.get("public") is not False or bucket.get("id") != self.bucket:
                    raise StorageError("Private PDF bucket is unavailable.")
                yield client
        except StorageError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise StorageError("Private PDF storage operation failed.") from None

    @staticmethod
    def check(response):
        if not 200 <= response.status_code < 300:
            raise StorageError("Private PDF storage operation failed.")

    @staticmethod
    def read_bounded(response, maximum):
        output = bytearray()
        deadline = time.monotonic() + 20
        for chunk in response.iter_bytes(chunk_size=64 * 1024):
            if time.monotonic() > deadline or len(output) + len(chunk) > maximum:
                raise StorageError("Private PDF storage response exceeded limits.")
            output.extend(chunk)
        return bytes(output)

    def save(self, key, content):
        validate_key(key)
        if not 0 < len(content) <= MAX_BYTES:
            raise StorageError("PDF storage size limit exceeded.")
        with self.client() as client:
            with client.stream("POST", f"{self.url}/object/{self.bucket}/{key}",
                               content=content, headers={"Content-Type": "application/pdf", "x-upsert": "false"}) as response:
                self.check(response)

    def retrieve(self, key):
        validate_key(key)
        with self.client() as client:
            with client.stream("GET", f"{self.url}/object/authenticated/{self.bucket}/{key}") as response:
                self.check(response)
                content = self.read_bounded(response, MAX_BYTES)
                if not content:
                    raise StorageError("Private PDF object is empty.")
                return content

    def delete(self, key):
        validate_key(key)
        with self.client() as client:
            # The remove API accepts exact prefixes (not wildcard patterns).
            with client.stream("DELETE", f"{self.url}/object/{self.bucket}",
                               json={"prefixes": [key]}) as response:
                self.check(response)


@contextmanager
def retrieve_pdf(key):
    validate_key(key)
    if not remote_storage():
        from app.documents import document_path
        yield document_path(key)
        return
    content = SupabasePDFStorage().retrieve(key)
    # Directory is private (0700); file is closed before Windows parser startup.
    with TemporaryDirectory(prefix="healthcareassist-pdf-") as directory:
        path = Path(directory) / key
        with path.open("xb") as handle:
            handle.write(content)
        yield path


def delete_remote_document(item):
    """DB first: never remove the only PDF on a failed/uncertain DB commit."""
    from sqlalchemy import select
    from app.extensions import db
    from app.models import Document

    key = validate_key(item.stored_filename)
    document_id = item.id
    try:
        db.session.delete(item)
        db.session.commit()
    except Exception:
        db.session.rollback()
        try:
            committed = db.session.scalar(select(Document.id).where(Document.id == document_id)) is None
        except Exception:
            current_app.logger.error("PDF deletion commit uncertain; retain object %s for reconciliation.", key)
            raise StorageError("Document deletion requires reconciliation.") from None
        if not committed:
            raise
    try:
        SupabasePDFStorage().delete(key)
    except OSError:
        current_app.logger.error("PDF metadata deleted; object %s requires private storage reconciliation.", key)
        raise StorageError("Document deletion requires reconciliation.") from None
