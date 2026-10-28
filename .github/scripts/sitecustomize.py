"""Opt-in CI guard, inherited by Python children; never imported by application code."""

import os
import sys


if os.environ.get("HCA_CI_OFFLINE") == "1":
    _env_file = os.path.normcase(os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env")
    ))

    def _guard(event, args):
        if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
            if os.path.normcase(os.path.abspath(os.fsdecode(args[0]))) == _env_file:
                raise PermissionError("CI must not read backend/.env")
        if event in {"socket.connect", "socket.getaddrinfo"}:
            address = args[1] if event == "socket.connect" else args[:2]
            allowed_port = os.environ.get("HCA_CI_LOOPBACK_PORT", "")
            if (allowed_port and isinstance(address, tuple) and len(address) >= 2
                    and address[0] == "127.0.0.1" and str(address[1]) == allowed_port):
                return
            raise PermissionError("External network access forbidden during CI verification")
        if event == "socket.sendto":
            raise PermissionError("Datagram network access forbidden during CI verification")

    sys.addaudithook(_guard)
    sys._hca_ci_offline = True

    if os.environ.get("HCA_CI_NO_DATABASE") == "1":
        # libpq can open C-level sockets outside Python's socket audit events.
        # Only the Gunicorn smoke child opts in; PDF import-isolation is intact.
        from sqlalchemy import event as _event
        from sqlalchemy.engine import Engine as _Engine

        def _deny_database(*args, **kwargs):
            raise RuntimeError("Database connections forbidden during Gunicorn smoke verification")

        _event.listen(_Engine, "do_connect", _deny_database)
