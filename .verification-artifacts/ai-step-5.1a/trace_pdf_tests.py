"""Offline diagnostic wrapper: retain import timings for synthetic PDF workers."""
import json
from pathlib import Path
import subprocess
import sys
import time

import pytest

ROOT = Path(__file__).resolve().parents[2]
real_run = subprocess.run
rows = []
output_directory = Path(__file__).parent / "trace-after"
output_directory.mkdir(exist_ok=True)


def traced_run(command, *args, **kwargs):
    if not isinstance(command, list) or not any(
        name in command for name in ("app.pdf_validation", "app.pdf_extraction")
    ):
        return real_run(command, *args, **kwargs)
    label = next(name for name in command if name.startswith("app.pdf_"))
    trace = output_directory / f"worker-import-{len(rows)}.txt"
    row = {"worker": label, "timeout": kwargs.get("timeout"), "trace": trace.name}
    rows.append(row)
    started = time.perf_counter()
    try:
        with trace.open("wb") as stderr:
            kwargs["stderr"] = stderr
            result = real_run([command[0], "-X", "importtime", *command[1:]], *args, **kwargs)
        row["returncode"] = result.returncode
        return result
    except subprocess.TimeoutExpired:
        row["exception"] = "TimeoutExpired"
        raise
    finally:
        row["wall_seconds"] = time.perf_counter() - started
        (output_directory / "pytest-worker-timings.json").write_text(json.dumps(rows, indent=2))


subprocess.run = traced_run
test_args = sys.argv[1:] or [
    "-q", "backend/tests/test_documents.py::test_default_title_and_case_insensitive_extension",
    "backend/tests/test_documents.py::test_duplicate_original_names_have_unique_internal_names",
    "backend/tests/test_document_processing.py::test_failed_processing_clears_partial_chunks_and_can_retry",
]
raise SystemExit(pytest.main(["-q", "--tb=short", "--durations=5", *test_args]))
