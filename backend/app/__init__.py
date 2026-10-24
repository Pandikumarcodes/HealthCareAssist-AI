from __future__ import annotations

from collections.abc import Mapping


def create_app(test_config: Mapping[str, object] | None = None) -> Flask:
    """Create and configure the HealthCareAssist AI Flask application."""
    # Python imports this package before running either PDF worker. Load the web
    # stack only when creating an app, so parser deadlines cover parser work and
    # resource limits are installed before third-party application imports.
    from flask import Flask

    from app.config import BACKEND_DIRECTORY, Config, TestingConfig, local_configuration
    from app.database import check_database_command
    from app.extensions import db, migrate
    from app.routes import health_bp
    from app.routes.dashboard import dashboard_bp
    from app.routes.requests import requests_bp
    from app.routes.documents import documents_bp
    from app.document_processing import process_document_command
    from app.routes.ai import ai_bp
    from app.auth import init_auth

    app = Flask(__name__)
    app.config.from_object(TestingConfig if test_config is not None else Config)

    if test_config is None:
        app.config.from_mapping(local_configuration())

    if test_config is not None:
        app.config.from_mapping(test_config)

    db.init_app(app)
    migrate.init_app(app, db, directory=str(BACKEND_DIRECTORY / "migrations"))
    app.cli.add_command(check_database_command)
    app.cli.add_command(process_document_command)
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(dashboard_bp, url_prefix="/api")
    app.register_blueprint(requests_bp, url_prefix="/api")
    app.register_blueprint(documents_bp, url_prefix="/api")
    app.register_blueprint(ai_bp, url_prefix="/api")
    init_auth(app)

    return app
