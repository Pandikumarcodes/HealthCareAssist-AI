from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "HealthCareAssist AI",
        "version": "1.0.0"
    }), 200