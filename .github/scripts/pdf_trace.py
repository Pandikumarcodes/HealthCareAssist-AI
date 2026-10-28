"""CI-only instrumented worker; runs the unchanged original main and limits."""

import time

ENTRY = time.perf_counter()
import builtins
import importlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
output, worker_name = Path(sys.argv[1]), sys.argv[2]
events = {"python_entry": ENTRY}


def mark(name):
    events[name] = time.perf_counter()
    # Persist incomplete imports too, so a deadline kill retains the last stage.
    output.write_text(json.dumps(events), encoding="utf-8")


original_import = builtins.__import__


def traced_import(name, *args, **kwargs):
    observed = name in {"pypdf", "pymupdf"} and name not in sys.modules
    if observed:
        mark(name + "_import_start")
    module = original_import(name, *args, **kwargs)
    if observed:
        mark(name + "_import_end")
        target, attribute = (module.PdfReader, "__init__") if name == "pypdf" else (module, "open")
        original = getattr(target, attribute)

        def opened(*a, **kw):
            mark("pdf_open_start")
            try:
                return original(*a, **kw)
            finally:
                mark("pdf_open_end")

        setattr(target, attribute, opened)
    return module


builtins.__import__ = traced_import
sys.argv = [worker_name, *sys.argv[3:]]
mark("module_import_start")
worker = importlib.import_module(worker_name)
mark("module_import_end")
mark("validation_start")
try:
    status = worker.main()
finally:
    mark("validation_end")
sys.exit(status)
