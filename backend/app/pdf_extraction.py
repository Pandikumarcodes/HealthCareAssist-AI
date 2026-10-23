"""Bounded page extraction and deterministic page-local chunks; no OCR."""

import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryFile

from app.config import BACKEND_DIRECTORY

MAX_PAGES = 100
MAX_PAGE_CHARACTERS = 100_000
MAX_TEXT_CHARACTERS = 1_000_000
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 150
MAX_CHUNKS = 2000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


class ExtractionError(ValueError):
    """An untrusted document could not be safely processed; never includes text."""


def normalize_text(text):
    text = "".join(" " if ord(char) < 32 else char for char in text)
    return re.sub(r"\s+", " ", text).strip()


def split_page(text):
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + CHUNK_SIZE // 2, end)
            if boundary > start:
                end = boundary
        chunk = text[start:end].strip()
        if chunk:
            yield chunk
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
        # Begin overlap at a word boundary when available, preserving context.
        boundary = text.find(" ", start, end)
        if boundary != -1:
            start = boundary + 1


def extract_pages(document):
    """Pure extraction core, called only in the limited child in production."""
    if not document.is_pdf or document.is_encrypted or document.needs_pass or document.is_repaired:
        raise ExtractionError("Unreadable or encrypted PDF.")
    if not 1 <= document.page_count <= MAX_PAGES:
        raise ExtractionError("PDF page limit exceeded.")
    chunks, total = [], 0
    for page_number in range(1, document.page_count + 1):
        raw = document.load_page(page_number - 1).get_text("text", sort=True)
        total += len(raw)
        if len(raw) > MAX_PAGE_CHARACTERS or total > MAX_TEXT_CHARACTERS:
            raise ExtractionError("PDF text limit exceeded.")
        for content in split_page(normalize_text(raw)):
            chunks.append({"page_number": page_number, "chunk_index": len(chunks), "content": content})
            if len(chunks) > MAX_CHUNKS:
                raise ExtractionError("PDF chunk limit exceeded.")
    return chunks


def extract_chunks(path):
    """Open a stored PDF in a limited synchronous child and bound its output."""
    try:
        path = Path(path)
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 5 * 1024 * 1024:
            raise ExtractionError("PDF file is unavailable or oversized.")
        with TemporaryFile() as output:
            result = subprocess.run(
                [sys.executable, "-m", "app.pdf_extraction", str(path.resolve())],
                cwd=BACKEND_DIRECTORY, stdin=subprocess.DEVNULL, stdout=output,
                stderr=subprocess.DEVNULL, timeout=10, check=False,
            )
            if result.returncode != 0 or output.seek(0, 2) > MAX_OUTPUT_BYTES:
                raise ExtractionError("PDF extraction failed or exceeded processing limits.")
            output.seek(0)
            chunks = json.loads(output.read(MAX_OUTPUT_BYTES + 1))
        if not isinstance(chunks, list) or len(chunks) > MAX_CHUNKS:
            raise ExtractionError("Invalid extraction result.")
        total = 0
        for index, chunk in enumerate(chunks):
            if (not isinstance(chunk, dict) or set(chunk) != {"page_number", "chunk_index", "content"}
                    or type(chunk["page_number"]) is not int or not 1 <= chunk["page_number"] <= MAX_PAGES
                    or type(chunk["chunk_index"]) is not int or chunk["chunk_index"] != index
                    or not isinstance(chunk["content"], str) or not chunk["content"].strip()
                    or not 0 < len(chunk["content"]) <= CHUNK_SIZE or "\x00" in chunk["content"]
                    or (index > 0 and chunk["page_number"] < chunks[index - 1]["page_number"])):
                raise ExtractionError("Invalid extraction result.")
            total += len(chunk["content"])
        if total > MAX_TEXT_CHARACTERS + MAX_CHUNKS * CHUNK_OVERLAP:
            raise ExtractionError("Invalid extraction result size.")
        return chunks
    except ExtractionError:
        raise
    except Exception:
        raise ExtractionError("PDF extraction failed or exceeded processing limits.") from None


def main():
    try:
        from app.pdf_limits import enforce_limits

        enforce_limits()
        import pymupdf

        pymupdf.TOOLS.mupdf_display_errors(False)
        pymupdf.TOOLS.mupdf_display_warnings(False)
        with pymupdf.open(sys.argv[1]) as document:
            chunks = extract_pages(document)
        json.dump(chunks, sys.stdout, ensure_ascii=True)
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
