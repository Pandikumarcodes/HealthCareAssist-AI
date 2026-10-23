"""Question validation and bounded retrieval using the existing PostgreSQL search."""

import json

from werkzeug.exceptions import BadRequest

from app import document_search
from app.gemini import GeminiService, no_information
from app.support_requests import RequestValidationError


RETRIEVAL_LIMIT = 5


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field.")
        result[key] = value
    return result


def validate_question(http_request):
    http_request.max_content_length = 16 * 1024
    try:
        payload = json.loads(http_request.get_data(), object_pairs_hook=_unique_object) if http_request.is_json else None
    except (ValueError, UnicodeError, RecursionError, BadRequest):
        raise RequestValidationError({"body": "Must contain a valid JSON object without duplicate fields."}) from None
    if not isinstance(payload, dict):
        raise RequestValidationError({"body": "Must contain a valid JSON object."})
    if set(payload) - {"question"}:
        # Do not echo unknown field names; they may themselves contain secrets.
        raise RequestValidationError({"body": "Only the question field is allowed."})
    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        raise RequestValidationError({"question": "A nonempty question string is required."})
    if len(question) > 1000:
        raise RequestValidationError({"question": "Must be at most 1000 characters."})
    if any(ord(char) < 32 and char not in "\n\r\t" or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF for char in question):
        raise RequestValidationError({"question": "Must not contain invalid control or Unicode characters."})
    return question.strip()


def retrieve_passages(question):
    if not any(char.isalnum() for char in question):
        return []
    # The public document search endpoint keeps its 200-character validation;
    # this internal query accepts the AI endpoint's validated 1000-character limit.
    rows = document_search.execute_search(question, RETRIEVAL_LIMIT)
    passages = []
    for row in rows[:RETRIEVAL_LIMIT]:
        if (any(type(row.get(key)) is not int or row[key] <= 0 for key in ("document_id", "chunk_id", "page_number"))
                or not isinstance(row.get("document_title"), str) or not row["document_title"].strip()
                or len(row["document_title"]) > 200
                or not isinstance(row.get("text"), str) or not row["text"].strip() or len(row["text"]) > 1200):
            raise ValueError("Invalid search record.")
        if any(previous["chunk_id"] == row["chunk_id"] for previous in passages):
            raise ValueError("Duplicate search record.")
        passages.append({key: row[key] for key in (
            "document_id", "document_title", "page_number", "chunk_id", "text",
        )})
    return passages


def ask_question(question, config):
    passages = retrieve_passages(question)
    if not passages:
        return no_information()
    return GeminiService(config).answer(question, passages)
