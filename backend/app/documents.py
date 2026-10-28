"""Document validation and private file storage; metadata is the only API output."""

from datetime import timezone
from pathlib import Path
import re
import stat
import subprocess
import sys
from uuid import uuid4

from flask import current_app
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import NotFound, RequestEntityTooLarge

from app.config import BACKEND_DIRECTORY
from app.extensions import db
from app.models import Document


MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_REQUEST_SIZE = MAX_FILE_SIZE + 64 * 1024  # Multipart headers/title allowance.
MAX_INTEGER = 2_147_483_647
STORED_NAME = re.compile(r"[0-9a-f]{32}\.pdf")


class DocumentValidationError(ValueError):
    def __init__(self, field, message):
        super().__init__("Invalid input.")
        self.details = {field: message}


def invalid(field, message):
    raise DocumentValidationError(field, message)


def validate_upload(http_request):
    # Set limits before Werkzeug parses/spools any multipart data. Other APIs keep
    # their existing limits. Bound parts and non-file form fields as well.
    http_request.max_content_length = MAX_REQUEST_SIZE
    # Werkzeug also applies this limit to its 64 KiB multipart decoding buffer.
    http_request.max_form_memory_size = 128 * 1024
    http_request.max_form_parts = 4
    if http_request.mimetype != "multipart/form-data":
        invalid("file", "Use multipart/form-data with one PDF file.")
    files, form = http_request.files, http_request.form
    if set(files) != {"file"} or len(files.getlist("file")) != 1:
        invalid("file", "Provide exactly one PDF file.")
    if set(form) - {"title"} or len(form.getlist("title")) > 1:
        invalid("title", "Only one optional title field is allowed.")
    upload = files["file"]
    filename = upload.filename or ""
    # Reject both Windows and POSIX paths, including drive/ADS and control bytes.
    if (not filename or len(filename) > 255 or filename in {".", ".."}
            or any(c in filename for c in '/\\:')
            or any(ord(c) < 32 or ord(c) == 127 for c in filename)):
        invalid("file", "Provide a filename without paths or control characters (maximum 255 characters).")
    if Path(filename).suffix.lower() != ".pdf":
        invalid("file", "Only .pdf files are accepted.")
    title = form.get("title", Path(filename).stem).strip()
    if not title or len(title) > 200 or any(ord(c) < 32 or ord(c) == 127 for c in title):
        invalid("title", "Must be a nonblank title of at most 200 characters without control characters.")
    content = upload.stream.read(MAX_FILE_SIZE + 1)
    if len(content) > MAX_FILE_SIZE:
        raise RequestEntityTooLarge("PDF files must be at most 5 MiB (5,242,880 bytes).")
    if not content:
        invalid("file", "The PDF file must not be empty.")
    if (not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\r|\n)", content)
            or not content.rstrip().endswith(b"%%EOF")):
        invalid("file", "Provide a valid, complete PDF document.")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "app.pdf_validation"], input=content,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            cwd=BACKEND_DIRECTORY, timeout=5, check=False,
        )
    except subprocess.TimeoutExpired:
        invalid("file", "The PDF structure could not be validated within the time limit.")
    if result.returncode != 0:
        if result.returncode == 2:
            raise OSError("PDF validation resource protection unavailable.")
        invalid("file", "Provide a valid, unencrypted PDF with at least one page.")
    # Client MIME headers are advisory. Canonical type comes from validated bytes.
    return {"title": title, "original_filename": filename,
            "content_type": "application/pdf", "file_size": len(content)}, content


def storage_directory():
    directory = Path(current_app.config["DOCUMENT_UPLOAD_DIR"])
    if not directory.is_absolute():
        directory = BACKEND_DIRECTORY / directory
    directory = directory.resolve()
    # Fail closed for accidental configuration into publicly served assets.
    public_roots = [BACKEND_DIRECTORY.parent / "frontend"]
    public_roots.append(Path(current_app.static_folder))
    if any(directory.is_relative_to(root.resolve()) for root in public_roots):
        raise OSError("Document storage must be private.")
    return directory


def document_path(stored_filename):
    if not STORED_NAME.fullmatch(stored_filename):
        raise OSError("Invalid internal storage identifier.")
    path = storage_directory() / stored_filename
    # Do not follow symlinks/junctions, even when metadata was manually corrupted.
    if path.is_symlink() or path.resolve().parent != storage_directory():
        raise OSError("Unsafe document storage entry.")
    return path


def write_upload(content):
    from app.pdf_storage import remote_storage, SupabasePDFStorage
    if remote_storage():
        name = uuid4().hex + ".pdf"
        try:
            SupabasePDFStorage().save(name, content)
        except OSError:
            # An unknown upload outcome or collision must never trigger a delete.
            current_app.logger.error("PDF upload unconfirmed; object %s may need reconciliation.", name)
            raise
        return name, name
    directory = storage_directory()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for _ in range(5):
        name = uuid4().hex + ".pdf"
        path = document_path(name)
        try:
            handle = path.open("xb")  # Exclusive creation; collisions never overwrite.
        except FileExistsError:
            continue
        try:
            with handle:
                handle.write(content)
        except Exception:
            cleanup_upload(path)
            raise
        return name, path
    raise OSError("Unable to allocate a unique storage identifier.")


def cleanup_upload(path):
    try:
        from app.pdf_storage import remote_storage, SupabasePDFStorage
        if remote_storage():
            SupabasePDFStorage().delete(path)
        else:
            path.unlink(missing_ok=True)
    except OSError:
        from app.pdf_storage import remote_storage
        if remote_storage():
            current_app.logger.error("PDF upload cleanup failed; object %s needs reconciliation.", path)
        else:
            current_app.logger.error("Document upload cleanup failed; private storage needs reconciliation.")


def serialize_document(item):
    created_at = item.created_at
    if created_at.tzinfo is None:  # SQLite test databases omit tzinfo.
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": item.id, "title": item.title, "original_filename": item.original_filename,
        "file_size": item.file_size, "content_type": item.content_type,
        "created_at": created_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "processing_status": item.processing_status,
    }


def find_document(document_id, *, lock=False):
    if (not re.fullmatch(r"[0-9]{1,10}", document_id)
            or not 1 <= int(document_id) <= MAX_INTEGER):
        raise NotFound("Document not found.")
    query = select(Document).where(Document.id == int(document_id))
    if lock:
        query = query.with_for_update()
    item = db.session.scalar(query)
    if item is None:
        raise NotFound("Document not found.")
    return item


def list_documents(args):
    if any(key not in {"page", "page_size"} or len(args.getlist(key)) != 1 for key in args):
        invalid("query", "Only one page and one page_size parameter are allowed.")
    values = {}
    for key, default, maximum in (("page", 1, MAX_INTEGER), ("page_size", 20, 100)):
        raw = args.get(key, str(default))
        if not re.fullmatch(r"[0-9]{1,10}", raw) or not 1 <= int(raw) <= maximum:
            invalid(key, f"Must be an integer from 1 to {maximum}.")
        values[key] = int(raw)
    page, page_size = values["page"], values["page_size"]
    total = db.session.scalar(select(func.count(Document.id)))
    items = db.session.scalars(select(Document)
        .order_by(Document.created_at.desc(), Document.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    return {"data": [serialize_document(item) for item in items], **values,
            "total": total, "total_pages": (total + page_size - 1) // page_size}


def delete_document(item):
    from app.pdf_storage import remote_storage, delete_remote_document
    if remote_storage():
        return delete_remote_document(item)
    path = document_path(item.stored_filename)
    document_id, stored_filename = item.id, item.stored_filename
    staged = None
    commit_attempted = False
    try:
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            pass  # Already absent: safely remove the stale metadata.
        else:
            if not stat.S_ISREG(mode):
                raise OSError("Document is not a regular file.")
            # An exclusive directory prevents replacing any existing file while
            # staging. Name retains the document identity for manual recovery.
            candidate = path.parent / (".delete-" + str(item.id) + "-" + uuid4().hex)
            candidate.mkdir(mode=0o700)
            staged = candidate  # Only clean up a directory this operation owns.
            path.rename(staged / path.name)
        db.session.delete(item)
        commit_attempted = True
        db.session.commit()
    except Exception:
        db.session.rollback()
        committed = False
        if commit_attempted:
            try:
                committed = db.session.scalar(select(Document.id).where(
                    Document.id == document_id, Document.stored_filename == stored_filename,
                )) is None
            except SQLAlchemyError:
                # Keep the only backup when the commit outcome cannot be known.
                current_app.logger.error("Document deletion commit uncertain; private storage needs reconciliation.")
                raise
        if not committed:
            if staged is not None:
                backup = staged / path.name
                try:
                    if backup.exists():
                        # Do not overwrite another entry during rollback.
                        if path.exists() or path.is_symlink():
                            raise OSError("Restore destination occupied.")
                        backup.rename(path)
                    staged.rmdir()
                except OSError:
                    current_app.logger.error("Document deletion restore failed; private storage needs reconciliation.")
            raise
    if staged is not None:
        try:
            (staged / path.name).unlink()
            staged.rmdir()
        except OSError:
            # Metadata deletion is committed. Keep the isolated tombstone for
            # manual purge; reporting a rollback here would be misleading.
            current_app.logger.error("Document deletion committed; staged file purge needs reconciliation.")
