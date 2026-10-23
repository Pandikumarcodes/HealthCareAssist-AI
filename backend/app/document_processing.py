"""Atomic chunk persistence. The caller owns the transaction and document lock."""

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import delete

from app.documents import document_path, find_document
from app.extensions import db
from app.models import DocumentChunk
from app.pdf_extraction import ExtractionError, extract_chunks


def index_document(item):
    # A retry of a completed document preserves its existing chunk IDs and order.
    if item.processing_status in {"INDEXED", "NO_TEXT"}:
        return
    try:
        chunks = extract_chunks(document_path(item.stored_filename))
    except (ExtractionError, OSError):
        chunks = []
        outcome = "FAILED"
        current_app.logger.warning("PDF processing failed; document remains available for management.")
    else:
        outcome = "INDEXED" if chunks else "NO_TEXT"
    # No chunks are written before extraction completes. Any DB failure propagates
    # and rolls back the whole upload/retry, including an attempted replacement.
    db.session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == item.id))
    db.session.add_all([DocumentChunk(document_id=item.id, **chunk) for chunk in chunks])
    item.processing_status = outcome
    db.session.flush()


@click.command("process-document")
@click.argument("document_id", type=click.IntRange(1, 2_147_483_647))
@with_appcontext
def process_document_command(document_id):
    """Synchronously index an existing/unprocessed/failed fictional document."""
    try:
        item = find_document(str(document_id), lock=True)
        index_document(item)
        status = item.processing_status
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise click.ClickException("Document processing failed; verify its status before retrying.") from None
    click.echo(f"Document {document_id}: {status}.")
