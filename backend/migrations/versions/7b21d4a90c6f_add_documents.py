"""Add document metadata only.

Revision ID: 7b21d4a90c6f
Revises: 3db23834e8ac
"""

from alembic import op
import sqlalchemy as sa


revision = "7b21d4a90c6f"
down_revision = "3db23834e8ac"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("stored_filename", sa.String(36), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("length(trim(title)) > 0 AND length(title) <= 200", name="ck_documents_title"),
        sa.CheckConstraint("file_size > 0 AND file_size <= 5242880", name="ck_documents_file_size"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stored_filename"),
    )


def downgrade():
    op.drop_table("documents")
