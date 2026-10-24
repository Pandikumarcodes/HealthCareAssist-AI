"""Exercise setup with ephemeral credentials in a disposable directory only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import secrets
import tempfile
from unittest.mock import patch

from werkzeug.security import check_password_hash

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("demo_setup", root / "backend/scripts/generate_demo_auth.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
password = secrets.token_urlsafe(24)
with tempfile.TemporaryDirectory(prefix="auth-setup-", dir=Path(__file__).parent) as directory:
    module.__file__ = str(Path(directory) / "backend/scripts/generate_demo_auth.py")
    output = io.StringIO()
    with patch.object(module.sys.stdin, "isatty", return_value=True), patch("builtins.input", return_value="fictional-setup"), patch.object(module.getpass, "getpass", return_value=password), contextlib.redirect_stdout(output):
        module.main()
        target = Path(directory) / "backend/instance/demo-auth.json"
        values = json.loads(target.read_text())
        assert check_password_hash(values["DEMO_PASSWORD_HASH"], password)
        assert len(values["SECRET_KEY"]) == 64
        assert all(secret not in output.getvalue() for secret in (password, values["DEMO_PASSWORD_HASH"], values["SECRET_KEY"]))
        before = target.read_bytes()
        try:
            module.main()
        except SystemExit as error:
            assert "already exists" in str(error)
        else:
            raise AssertionError("Setup overwrote existing configuration")
        assert before == target.read_bytes()
    with patch.object(module.sys.stdin, "isatty", return_value=False):
        try:
            module.main()
        except SystemExit as error:
            assert "interactive terminal" in str(error)
        else:
            raise AssertionError("Noninteractive password input was allowed")
result = {"hidden_input": "PASS", "hash_verification": "PASS", "no_secret_output": "PASS", "no_overwrite": "PASS", "noninteractive_rejected": "PASS", "real_configuration_written": False}
(Path(__file__).parent / "setup-verification.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
