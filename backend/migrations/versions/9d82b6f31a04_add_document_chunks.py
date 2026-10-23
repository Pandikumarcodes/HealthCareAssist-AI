"""Add document processing status, chunks and PostgreSQL lexical search index.

Revision ID: 9d82b6f31a04
Revises: 7b21d4a90c6f
"""

from alembic import op
import sqlalchemy as sa

revision = "9d82b6f31a04"
down_revision = "7b21d4a90c6f"
branch_labels = None
depends_on = None


def upgrade():
    # Existing documents remain UNPROCESSED; no files or text are touched here.
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("processing_status", sa.String(20), nullable=False, server_default="UNPROCESSED"))
        batch.create_check_constraint("ck_documents_processing_status",
            "processing_status IN ('UNPROCESSED', 'INDEXED', 'NO_TEXT', 'FAILED')")
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_order"),
        sa.CheckConstraint("page_number > 0", name="ck_document_chunks_page"),
        sa.CheckConstraint("chunk_index >= 0", name="ck_document_chunks_index"),
        sa.CheckConstraint("length(trim(content)) > 0 AND length(content) <= 1200", name="ck_document_chunks_content"),
    )
    if op.get_context().dialect.name == "postgresql":
        op.create_index("ix_document_chunks_search", "document_chunks",
                        [sa.text("to_tsvector('english'::regconfig, content)")], postgresql_using="gin")


def downgrade():
    op.drop_table("document_chunks")
    with op.batch_alter_table("documents") as batch:
        batch.drop_constraint("ck_documents_processing_status", type_="check")
        batch.drop_column("processing_status")
