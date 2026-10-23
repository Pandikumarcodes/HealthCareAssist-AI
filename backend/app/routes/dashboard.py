from flask import Blueprint, current_app, jsonify
from sqlalchemy.exc import SQLAlchemyError

from app.dashboard import get_dashboard_summary
from app.extensions import db

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/dashboard/summary")
def dashboard_summary():
    try:
        summary = get_dashboard_summary()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.error("Dashboard summary database query failed.")
        return jsonify({"error": "Dashboard summary is temporarily unavailable. Please try again."}), 503
    return jsonify(summary), 200
