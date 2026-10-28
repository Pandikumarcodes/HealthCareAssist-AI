"""One fictional account, signed-cookie sessions and synchronizer CSRF tokens.

No database users, CORS, external identity provider or testing-mode bypass.
Imported by the factory only, never by disposable PDF workers.
"""

import hashlib
import hmac
import re
import secrets
import time

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from werkzeug.security import check_password_hash

auth_bp = Blueprint("auth", __name__)
USER = {"id": "demo", "display_name": "Demo User"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
PUBLIC_ENDPOINTS = {"health.health_check", "auth.login", "auth.me"}


def configured():
    config = current_app.config
    key, username, password_hash = (config.get(name) for name in (
        "SECRET_KEY", "DEMO_USERNAME", "DEMO_PASSWORD_HASH",
    ))
    # Accept current Werkzeug scrypt or strong PBKDF2 hashes with bounded cost.
    valid_hash = isinstance(password_hash, str) and re.fullmatch(
        r"(?:scrypt:32768:8:1\$[A-Za-z0-9]{16,64}\$[a-f0-9]{128}|"
        r"pbkdf2:sha256:(?:600000|1000000)\$[A-Za-z0-9]{16,64}\$[a-f0-9]{64})",
        password_hash,
    )
    return (isinstance(key, str) and len(key) >= 32
            and not any(marker in key.lower() for marker in ("your_", "replace", "changeme"))
            and isinstance(username, str) and 1 <= len(username) <= 100
            and username == username.strip() and not any(ord(c) < 32 for c in username)
            and bool(valid_hash))


def credential_version():
    # A cookie is signed, not encrypted: never place credentials or their hash in it.
    value = current_app.config["DEMO_USERNAME"] + "\0" + current_app.config["DEMO_PASSWORD_HASH"]
    return hmac.new(current_app.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def authenticated():
    expires = session.get("expires_at")
    valid = (session.get("user_id") == "demo" and type(expires) in (int, float)
             and time.time() < expires
             and session.get("credential_version") == credential_version())
    if not valid:
        session.clear()
    return valid


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def error(message, status, code):
    return jsonify({"error": message, "code": code}), status


def csrf_valid():
    # The Vite proxy retains the browser's Host. HTTPS reverse proxies must
    # preserve the public Host/scheme; no blindly trusted forwarded headers.
    origin = request.headers.get("Origin")
    if origin is not None and origin != request.host_url.rstrip("/"):
        return False
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        return False
    supplied, expected = request.headers.get("X-CSRF-Token", ""), session.get("csrf_token", "")
    return (isinstance(expected, str) and bool(expected) and bool(re.fullmatch(r"[A-Za-z0-9_-]{43}", supplied))
            and secrets.compare_digest(supplied, expected))


@auth_bp.post("/auth/login")
def login():
    request.max_content_length = 16 * 1024
    try:
        values = request.get_json(silent=True)
    except (BadRequest, RequestEntityTooLarge, RecursionError):
        values = None
    if not isinstance(values, dict) or set(values) != {"username", "password"}:
        return error("Invalid input.", 400, "auth_invalid_input")
    username, password = values["username"], values["password"]
    if (not isinstance(username, str) or not 1 <= len(username.strip()) <= 100
            or not isinstance(password, str) or not 1 <= len(password) <= 1024
            or any(ord(c) < 32 for c in username) or "\0" in password
            or any(0xD800 <= ord(c) <= 0xDFFF for c in username + password)):
        return error("Invalid input.", 400, "auth_invalid_input")
    # Always verify the hash, including when the username is wrong.
    matches = check_password_hash(current_app.config["DEMO_PASSWORD_HASH"], password)
    if not hmac.compare_digest(username.strip().encode(), current_app.config["DEMO_USERNAME"].encode()) or not matches:
        return error("Invalid username or password.", 401, "auth_invalid_credentials")
    session.clear()
    session.permanent = True
    session["user_id"] = "demo"
    session["expires_at"] = time.time() + current_app.permanent_session_lifetime.total_seconds()
    session["credential_version"] = credential_version()
    return jsonify({"user": USER, "csrf_token": csrf_token(), "expires_at": session["expires_at"]})


@auth_bp.get("/auth/me")
def me():
    if not authenticated():
        return jsonify({"error": "Authentication required.", "code": "auth_required",
                        "csrf_token": csrf_token()}), 401
    return jsonify({"user": USER, "csrf_token": csrf_token(), "expires_at": session["expires_at"]})


@auth_bp.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"message": "Signed out."})


def init_auth(app):
    app.register_blueprint(auth_bp, url_prefix="/api")

    @app.before_request
    def protect_api():
        # Unknown routes retain the existing 404 behavior. All registered API
        # operations are private unless explicitly listed here, including future ones.
        if request.endpoint in (None, "frontend_app") or not request.path.startswith("/api/") or request.endpoint == "health.health_check":
            return None
        if not configured():
            return error("Demo authentication is unavailable.", 503, "auth_unavailable")
        if request.endpoint not in PUBLIC_ENDPOINTS and not authenticated():
            return error("Authentication required.", 401, "auth_required")
        if request.method not in SAFE_METHODS and not csrf_valid():
            return error("Security check failed. Refresh and try again.", 403, "auth_csrf_failed")
        return None

    @app.after_request
    def private_cache_control(response):
        if request.path.startswith("/api/"):
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.path.startswith("/api/") and request.endpoint != "health.health_check":
            response.headers["Cache-Control"] = "no-store"
            response.vary.add("Cookie")
        return response
