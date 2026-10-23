"""Short-lived PDF structure validator. Never extract or execute PDF content.

Invoked in a subprocess with bounded input and a wall-clock timeout by documents.
Parser diagnostics are discarded by the parent because they can include input.
"""

from io import BytesIO
import sys

from app.pdf_limits import enforce_limits


def main():
    try:
        enforce_limits()
    except Exception:
        return 2  # Infrastructure unavailable: fail closed, not a malformed PDF.
    try:
        from pypdf import PdfReader

        content = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
        if not content or len(content) > 5 * 1024 * 1024:
            return 1
        with PdfReader(BytesIO(content), strict=True) as reader:
            if reader.is_encrypted or reader.root_object.get("/Type") != "/Catalog":
                return 1
            pages = reader.root_object["/Pages"]
            if pages.get("/Type") != "/Pages" or not reader.pages:
                return 1
            for page in reader.pages:
                if page.get("/Type") != "/Page" or len(page.mediabox) != 4:
                    return 1
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
