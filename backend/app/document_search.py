"""PostgreSQL lexical search. No SQLite imitation of PostgreSQL ranking."""

import re

from sqlalchemy import bindparam, func, literal_column, select

from app.documents import invalid
from app.extensions import db
from app.models import Document, DocumentChunk


def validate_search(args):
    if any(key not in {"q", "limit"} or len(args.getlist(key)) != 1 for key in args):
        invalid("query", "Only one q and one limit parameter are allowed.")
    query = args.get("q", "").strip()
    if not query or len(query) > 200 or any(ord(char) < 32 or ord(char) == 127 for char in query):
        invalid("q", "Provide 1–200 characters without control characters.")
    limit = args.get("limit", "10")
    if not re.fullmatch(r"[0-9]{1,2}", limit) or not 1 <= int(limit) <= 20:
        invalid("limit", "Must be an integer from 1 to 20.")
    return query, int(limit)


def search_statement():
    config = literal_column("'english'::regconfig")  # Fixed server-controlled index configuration.
    vector = func.to_tsvector(config, DocumentChunk.content)
    query = func.plainto_tsquery(config, bindparam("query"))
    score = func.ts_rank_cd(vector, query, 32).label("score")
    return (select(Document.id.label("document_id"), Document.title.label("document_title"),
                   DocumentChunk.id.label("chunk_id"), DocumentChunk.page_number,
                   DocumentChunk.content.label("text"), score)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(Document.processing_status == "INDEXED", vector.op("@@")(query))
            .order_by(score.desc(), Document.id.asc(), DocumentChunk.chunk_index.asc(), DocumentChunk.id.asc())
            .limit(bindparam("result_limit")))


def execute_search(query, limit):
    if db.engine.dialect.name != "postgresql":
        raise RuntimeError("Document full-text search requires PostgreSQL.")
    rows = db.session.execute(search_statement(), {"query": query, "result_limit": limit}).mappings()
    return [{**row, "score": float(row["score"])} for row in rows]


def search_documents(args):
    query, limit = validate_search(args)
    # Punctuation-only input has no searchable terms and needs no DB connection.
    results = execute_search(query, limit) if any(char.isalnum() for char in query) else []
    return {"query": query, "results": results}
