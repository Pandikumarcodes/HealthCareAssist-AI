"""Database access for dashboard summary data."""

from sqlalchemy import case, func, select

from app.extensions import db
from app.models import SupportRequest


def get_dashboard_summary() -> dict[str, int]:
    # One statement gives all counts the same database snapshot.
    row = db.session.execute(select(
        func.count(SupportRequest.id).label("total_requests"),
        func.count(case((SupportRequest.status == "OPEN", 1))).label("open_requests"),
        func.count(case((SupportRequest.status == "IN_PROGRESS", 1))).label("in_progress_requests"),
        func.count(case((SupportRequest.status == "RESOLVED", 1))).label("resolved_requests"),
    )).one()
    return {key: int(value) for key, value in row._mapping.items()}
