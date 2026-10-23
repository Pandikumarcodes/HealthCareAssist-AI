"""Support request REST endpoints; errors never include database details."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import HTTPException

from app.extensions import db
from app.models import SupportRequest
from app.support_requests import (
    RequestValidationError,
    find_request,
    list_requests,
    serialize_request,
    validate_payload,
    validate_query,
)


requests_bp = Blueprint("requests", __name__)


@requests_bp.errorhandler(RequestValidationError)
def validation_error(error):
    return jsonify({"error": "Invalid input.", "details": error.details}), 400


@requests_bp.errorhandler(HTTPException)
def http_error(error):
    return jsonify({"error": error.description}), error.code


@requests_bp.errorhandler(Exception)
def unexpected_error(error):
    db.session.rollback()
    current_app.logger.error("Support request operation failed.")
    return jsonify({"error": "Support request operation failed. Please try again."}), 500


@requests_bp.post("/requests")
def create_request():
    item = SupportRequest(**validate_payload(request), status="OPEN")
    db.session.add(item)
    db.session.commit()
    return jsonify({"data": serialize_request(item)}), 201


@requests_bp.get("/requests")
def get_requests():
    return jsonify(list_requests(validate_query(request.args))), 200


@requests_bp.get("/requests/<request_id>")
def get_request(request_id):
    return jsonify({"data": serialize_request(find_request(request_id))}), 200


@requests_bp.patch("/requests/<request_id>")
def update_request(request_id):
    item = find_request(request_id)
    for key, value in validate_payload(request, partial=True).items():
        setattr(item, key, value)
    # The existing model's onupdate hook maintains updated_at for changed fields.
    db.session.commit()
    return jsonify({"data": serialize_request(item)}), 200


@requests_bp.delete("/requests/<request_id>")
def delete_request(request_id):
    db.session.delete(find_request(request_id))
    db.session.commit()
    return "", 204
