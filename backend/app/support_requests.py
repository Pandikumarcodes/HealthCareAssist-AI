"""Validation, serialization, and bounded queries for support requests."""

from datetime import timezone
import re

from sqlalchemy import func, or_, select
from werkzeug.exceptions import BadRequest, NotFound

from app.extensions import db
from app.models import SupportRequest


CATEGORIES = frozenset({"GENERAL", "COVERAGE", "CLAIMS", "APPOINTMENT"})
STATUSES = frozenset({"OPEN", "IN_PROGRESS", "RESOLVED"})
CREATE_FIELDS = frozenset({"title", "description", "category"})
UPDATE_FIELDS = CREATE_FIELDS | {"status"}
QUERY_FIELDS = frozenset({"page", "page_size", "status", "category", "q"})
MAX_PAGE_SIZE = 100
MAX_INTEGER = 2_147_483_647  # The model uses PostgreSQL INTEGER IDs.


class RequestValidationError(ValueError):
    def __init__(self, details):
        super().__init__("Invalid input.")
        self.details = details


def validate_payload(http_request, *, partial=False):
    try:
        payload = http_request.get_json() if http_request.is_json else None
    except BadRequest:
        raise RequestValidationError({"body": "Must contain a valid JSON object."}) from None
    if not isinstance(payload, dict):
        raise RequestValidationError({"body": "Must contain a valid JSON object."})

    allowed = UPDATE_FIELDS if partial else CREATE_FIELDS
    errors = {key: "Unknown or server-managed field." for key in payload.keys() - allowed}
    if partial and not payload:
        errors["body"] = "Provide at least one field to update."
    if not partial:
        for key in CREATE_FIELDS - payload.keys():
            errors[key] = "This field is required."

    values = {}
    for key in allowed & payload.keys():
        value = payload[key]
        if not isinstance(value, str) or not value.strip():
            errors[key] = "Must be a nonblank string."
        elif "\x00" in value:
            errors[key] = "Must not contain null characters."
        elif key == "title" and len(value.strip()) > SupportRequest.title.type.length:
            errors[key] = "Must be at most 200 characters."
        elif key == "category" and value not in CATEGORIES:
            errors[key] = "Must be GENERAL, COVERAGE, CLAIMS, or APPOINTMENT."
        elif key == "status" and value not in STATUSES:
            errors[key] = "Must be OPEN, IN_PROGRESS, or RESOLVED."
        else:
            values[key] = value.strip() if key in {"title", "description"} else value

    if errors:
        raise RequestValidationError(errors)
    return values


def validate_query(args):
    errors = {}
    for key in args:
        if key not in QUERY_FIELDS:
            errors[key] = "Unknown query parameter."
        elif len(args.getlist(key)) != 1:
            errors[key] = "Provide this parameter only once."

    values = {"page": 1, "page_size": 20}
    for key, maximum in (("page", MAX_INTEGER), ("page_size", MAX_PAGE_SIZE)):
        if key in args:
            raw = args[key]
            if not re.fullmatch(r"[0-9]{1,10}", raw) or not 1 <= int(raw) <= maximum:
                errors[key] = f"Must be an integer from 1 to {maximum}."
            else:
                values[key] = int(raw)
    for key, allowed in (("status", STATUSES), ("category", CATEGORIES)):
        if key in args:
            if args[key] not in allowed:
                errors[key] = f"Must be one of: {', '.join(sorted(allowed))}."
            else:
                values[key] = args[key]
    if "q" in args:
        keyword = args["q"].strip()
        if len(keyword) > 200 or "\x00" in keyword:
            errors["q"] = "Must be at most 200 characters and contain no null characters."
        else:
            values["q"] = keyword
    if errors:
        raise RequestValidationError(errors)
    return values


def serialize_request(item):
    def timestamp(value):
        # SQLite drops timezone information in isolated tests; stored values are UTC.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "category": item.category,
        "status": item.status,
        "created_at": timestamp(item.created_at),
        "updated_at": timestamp(item.updated_at),
    }


def find_request(request_id):
    # Return the same JSON 404 for malformed, out-of-range, and missing IDs.
    if not re.fullmatch(r"[0-9]{1,10}", request_id) or not 1 <= int(request_id) <= MAX_INTEGER:
        raise NotFound("Support request not found.")
    item = db.session.get(SupportRequest, int(request_id))
    if item is None:
        raise NotFound("Support request not found.")
    return item


def list_requests(parameters):
    filters = []
    for key in ("status", "category"):
        if key in parameters:
            filters.append(getattr(SupportRequest, key) == parameters[key])
    if parameters.get("q"):
        # Escape LIKE metacharacters so the user's keyword is a literal substring.
        filters.append(or_(
            SupportRequest.title.icontains(parameters["q"], autoescape=True),
            SupportRequest.description.icontains(parameters["q"], autoescape=True),
        ))

    total = db.session.scalar(select(func.count(SupportRequest.id)).where(*filters))
    page, page_size = parameters["page"], parameters["page_size"]
    items = db.session.scalars(
        select(SupportRequest).where(*filters)
        .order_by(SupportRequest.created_at.desc(), SupportRequest.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "data": [serialize_request(item) for item in items],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size,
    }
