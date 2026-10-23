"""add support requests

Revision ID: 3db23834e8ac
Revises: 
Create Date: 2026-10-23 15:55:29.775523

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3db23834e8ac'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Reviewed additive migration: only the support_requests table is created.
    op.create_table('support_requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category', sa.String(length=20), server_default='GENERAL', nullable=False),
    sa.Column('status', sa.String(length=20), server_default='OPEN', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("category IN ('GENERAL', 'COVERAGE', 'CLAIMS', 'APPOINTMENT')", name='ck_support_requests_category'),
    sa.CheckConstraint("status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')", name='ck_support_requests_status'),
    sa.CheckConstraint('length(trim(title)) > 0 AND length(title) <= 200', name='ck_support_requests_title'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    op.drop_table('support_requests')
