"""Keep disposable PDF workers independent of the web application startup."""

import subprocess
import sys

import pytest

from app.config import BACKEND_DIRECTORY


@pytest.mark.parametrize("worker", ["app.pdf_validation", "app.pdf_extraction"])
def test_pdf_worker_imports_do_not_load_application_dependencies(worker):
    # A fresh interpreter catches transitive imports hidden by pytest's loaded
    # application modules. Check dependencies rather than fragile timing targets.
    program = """
import importlib
import sys

def forbid_application_imports(name, *args):
    if name.split('.')[0] in {
        'flask', 'sqlalchemy', 'flask_sqlalchemy', 'flask_migrate', 'alembic',
        'dotenv', 'google',
    }:
        raise AssertionError('PDF worker imported application dependencies')

sys.addaudithook(lambda event, args: forbid_application_imports(*args)
                 if event == 'import' else None)
importlib.import_module(sys.argv[1])
"""
    result = subprocess.run(
        [sys.executable, "-c", program, worker],
        cwd=BACKEND_DIRECTORY, capture_output=True, timeout=5,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
