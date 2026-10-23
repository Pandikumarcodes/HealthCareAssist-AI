"""PDF upload, processing outcomes, metadata management and lexical search APIs."""

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from app.documents import (
    DocumentValidationError, cleanup_upload, delete_document, find_document,
    list_documents, serialize_document, validate_upload, write_upload,
)
from app.extensions import db
from app.models import Document
from app.document_processing import index_document
from app.document_search import search_documents


documents_bp = Blueprint("documents", __name__)


@documents_bp.errorhandler(DocumentValidationError)
def validation_error(error):
    return jsonify({"error": "Invalid input.", "details": error.details}), 400


@documents_bp.errorhandler(HTTPException)
def http_error(error):
    if isinstance(error, RequestEntityTooLarge):
        return jsonify({"error": "PDF files must be at most 5 MiB (5,242,880 bytes); multipart requests must fit within 5 MiB + 64 KiB."}), 413
    return jsonify({"error": error.description}), error.code


@documents_bp.errorhandler(Exception)
def unexpected_error(error):
    db.session.rollback()
    current_app.logger.error("Document operation failed.")
    return jsonify({"error": "Document operation failed. Please try again."}), 500


@documents_bp.post("/documents")
def upload_document():
    values, content = validate_upload(request)
    stored_filename, path = write_upload(content)
    commit_attempted = False
    try:
        item = Document(**values, stored_filename=stored_filename)
        db.session.add(item)
        db.session.flush()
        index_document(item)
        # Serialize before commit so a later metadata load cannot turn a committed
        # upload into an error that removes its file.
        metadata = serialize_document(item)
        commit_attempted = True
        db.session.commit()
    except Exception:
        db.session.rollback()
        # A lost COMMIT acknowledgement can mean the row actually persisted.
        # Remove the new file only when non-persistence is known.
        persisted = False
        if commit_attempted:
            try:
                persisted = db.session.scalar(select(Document.id).where(
                    Document.stored_filename == stored_filename,
                )) is not None
            except SQLAlchemyError:
                persisted = True
                current_app.logger.error("Document upload commit uncertain; private storage needs reconciliation.")
        if not persisted:
            cleanup_upload(path)
        raise
    return jsonify({"data": metadata}), 201


@documents_bp.get("/documents")
def get_documents():
    return jsonify(list_documents(request.args)), 200


@documents_bp.get("/documents/search")
def search_document_chunks():
    return jsonify(search_documents(request.args)), 200


@documents_bp.get("/documents/<document_id>")
def get_document(document_id):
    return jsonify({"data": serialize_document(find_document(document_id))}), 200


@documents_bp.delete("/documents/<document_id>")
def remove_document(document_id):
    delete_document(find_document(document_id, lock=True))
    return "", 204
