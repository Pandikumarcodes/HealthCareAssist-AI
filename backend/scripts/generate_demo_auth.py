"""Interactive local setup: never echo credentials or overwrite existing files."""

import getpass
import json
import os
from pathlib import Path
import secrets
import sys

from werkzeug.security import generate_password_hash


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Run this script in an interactive terminal with hidden password input.")
    directory = Path(__file__).resolve().parents[1] / "instance"
    path = directory / "demo-auth.json"
    if path.exists():
        raise SystemExit("The local demo configuration already exists. Manage it manually to rotate credentials.")
    username = input("Fictional demo username: ").strip()
    if not 1 <= len(username) <= 100 or any(ord(c) < 32 for c in username):
        raise SystemExit("Choose a nonblank fictional username of up to 100 characters.")
    password = getpass.getpass("Demo password (hidden): ")
    confirmation = getpass.getpass("Confirm demo password (hidden): ")
    if len(password) < 12 or len(password) > 1024 or "\0" in password:
        raise SystemExit("Use a unique demo password of 12 to 1024 characters.")
    if password != confirmation:
        raise SystemExit("Passwords did not match; no file was written.")
    values = {"DEMO_USERNAME": username, "DEMO_PASSWORD_HASH": generate_password_hash(password, method="scrypt:32768:8:1"), "SECRET_KEY": secrets.token_hex(32)}
    directory.mkdir(parents=True, exist_ok=True)
    # Exclusive creation avoids overwriting a configuration created concurrently.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(values, stream)
    print("Created backend/instance/demo-auth.json. Keep it private; no credentials were printed.")


if __name__ == "__main__":
    main()
