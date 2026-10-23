"""Stateless AI assistant endpoint; no credentials or raw exceptions in responses."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from app.ai_assistant import ask_question, validate_question
from app.extensions import db
from app.gemini import GeminiError
from app.support_requests import RequestValidationError


ai_bp = Blueprint("ai", __name__)


@ai_bp.errorhandler(RequestValidationError)
def validation_error(error):
    return jsonify({"error": "Invalid input.", "details": error.details}), 400


@ai_bp.errorhandler(GeminiError)
def provider_error(error):
    return jsonify({"error": error.message, "code": error.code}), error.status


@ai_bp.errorhandler(HTTPException)
def http_error(error):
    message = "AI requests must be at most 16 KiB." if isinstance(error, RequestEntityTooLarge) else "Invalid AI request."
    return jsonify({"error": message}), error.code


@ai_bp.errorhandler(Exception)
def unexpected_error(error):
    db.session.rollback()
    current_app.logger.error("AI assistant operation failed.")
    return jsonify({"error": "AI assistant operation failed. Please try again."}), 500


@ai_bp.post("/ai/ask")
def ask():
    question = validate_question(request)
    return jsonify(ask_question(question, current_app.config)), 200
