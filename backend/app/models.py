"""Simple support request and document metadata persistence."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, func, literal_column

from app.extensions import db


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Document(db.Model):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0 AND length(title) <= 200", name="ck_documents_title"),
        CheckConstraint("file_size > 0 AND file_size <= 5242880", name="ck_documents_file_size"),
        CheckConstraint("processing_status IN ('UNPROCESSED', 'INDEXED', 'NO_TEXT', 'FAILED')", name="ck_documents_processing_status"),
    )

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(36), nullable=False, unique=True)
    content_type = db.Column(db.String(100), nullable=False)
    file_size = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now())
    processing_status = db.Column(db.String(20), nullable=False, default="UNPROCESSED", server_default="UNPROCESSED")
    chunks = db.relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(db.Model):
    __tablename__ = "document_chunks"
    __table_args__ = (
        db.UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_order"),
        CheckConstraint("page_number > 0", name="ck_document_chunks_page"),
        CheckConstraint("chunk_index >= 0", name="ck_document_chunks_index"),
        CheckConstraint("length(trim(content)) > 0 AND length(content) <= 1200", name="ck_document_chunks_content"),
    )

    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    page_number = db.Column(db.Integer, nullable=False)
    chunk_index = db.Column(db.Integer, nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now())
    document = db.relationship("Document", back_populates="chunks")


# Fixed, trusted expression matches the PostgreSQL migration and search query.
# The unique (document_id, chunk_index) index also supports FK deletion lookups.
document_chunks_search_index = db.Index(
    "ix_document_chunks_search",
    func.to_tsvector(literal_column("'english'::regconfig"), DocumentChunk.content),
    postgresql_using="gin",
).ddl_if(dialect="postgresql")
DocumentChunk.__table__.append_constraint(document_chunks_search_index)


class SupportRequest(db.Model):
    __tablename__ = "support_requests"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')", name="ck_support_requests_status"),
        CheckConstraint("category IN ('GENERAL', 'COVERAGE', 'CLAIMS', 'APPOINTMENT')", name="ck_support_requests_category"),
        CheckConstraint("length(trim(title)) > 0 AND length(title) <= 200", name="ck_support_requests_title"),
    )

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(20), nullable=False, default="GENERAL", server_default="GENERAL")
    status = db.Column(db.String(20), nullable=False, default="OPEN", server_default="OPEN")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now(), onupdate=utc_now)
