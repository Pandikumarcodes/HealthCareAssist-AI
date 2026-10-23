"""Explicit, read-only database verification independent of service health."""

import click
from flask.cli import with_appcontext
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.extensions import db


class DatabaseConnectionError(RuntimeError):
    """A database connection could not be verified."""


def verify_database_connection() -> None:
    """Execute SELECT 1; do not expose connection details on failure."""
    try:
        with db.engine.connect() as connection:
            if connection.execute(text("SELECT 1")).scalar_one() != 1:
                raise DatabaseConnectionError("Database verification returned an unexpected result.")
    except SQLAlchemyError:
        raise DatabaseConnectionError(
            "Database connection failed. Check DATABASE_URL and PostgreSQL availability."
        ) from None


@click.command("check-db")
@with_appcontext
def check_database_command() -> None:
    """Verify the configured database with SELECT 1."""
    try:
        verify_database_connection()
    except DatabaseConnectionError as error:
        raise click.ClickException(str(error)) from None
    click.echo("Database connection verified (SELECT 1).")
