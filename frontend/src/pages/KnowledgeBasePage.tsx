import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/layout/Icon";
import { DeleteDocumentDialog } from "../features/knowledge-base/DeleteDocumentDialog";
import { DocumentList } from "../features/knowledge-base/DocumentList";
import { DocumentUploadForm } from "../features/knowledge-base/DocumentUploadForm";
import {
  documentKeys,
  useDocumentMutations,
} from "../features/knowledge-base/queries";
import {
  getDocuments,
  hasControlCharacters,
  searchDocuments,
} from "../services/documents";
import type { DocumentMetadata } from "../services/documents";
import "../features/requests/requests.css";
import "../features/knowledge-base/knowledge-base.css";

export function KnowledgeBasePage() {
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<DocumentMetadata>();
  const [feedback, setFeedback] = useState(
    typeof location.state?.feedback === "string" ? location.state.feedback : "",
  );
  const deleteLock = useRef(false);
  const client = useQueryClient();
  const { upload, remove } = useDocumentMutations();
  const searching = !!input.trim();
  const invalidQuery =
    Array.from(input.trim()).length > 200 || hasControlCharacters(input.trim());
  const waiting = searching && input.trim() !== query;
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [input]);
  const list = useQuery({
    queryKey: documentKeys.list(page),
    enabled: !searching,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await getDocuments({ page, page_size: 20 }, signal);
      const last = Math.max(1, response.total_pages);
      if (page > last)
        await client.invalidateQueries({
          queryKey: documentKeys.list(last),
          exact: true,
        });
      return response;
    },
  });
  const search = useQuery({
    queryKey: documentKeys.search(query, limit),
    queryFn: ({ signal }) => searchDocuments(query, limit, signal),
    enabled: searching && !waiting && !invalidQuery && !!query,
    retry: false,
  });
  const documents = list.isError ? undefined : list.data;
  const last = Math.max(1, documents?.total_pages ?? 1);
  const correctingPage = !searching && !!documents && page > last;
  if (correctingPage) setPage(last);
  const searchData =
    !search.isError && !waiting && !invalidQuery ? search.data : undefined;
  const resetSearch = () => {
    setInput("");
    setQuery("");
  };
  const busy = searching
    ? waiting || search.isFetching
    : list.isFetching || correctingPage;
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">Your policy library</p>
          <h1 id="kb-heading" tabIndex={-1}>
            Knowledge Base
          </h1>
          <p>
            Keep fictional policies organized and find the passages you need.
          </p>
        </div>
        <span className="kb-library-label">
          <Icon name="book" /> PDF library
        </span>
      </div>
      <p className="kb-synthetic">
        <Icon name="shield" />
        <span>
          Fictional documents and synthetic data only. Do not upload real
          patient information.
        </span>
      </p>
      <div className="kb-workspace">
        <DocumentUploadForm
          pending={upload.isPending}
          onUpload={(value) => upload.mutateAsync(value)}
        />
        <section
          className="dashboard-panel kb-search"
          aria-labelledby="kb-search-heading"
        >
          <div className="panel-heading">
            <h2 id="kb-search-heading">Search document text</h2>
            <Icon name="book" />
          </div>
          <div className="request-form-body">
            <p className="kb-help">
              Find matching passages in searchable PDFs. This searches extracted
              content, rather than document titles.
            </p>
            <div className="request-field">
              <label htmlFor="document-search">Search PDF content</label>
              <input
                id="document-search"
                type="search"
                value={input}
                placeholder="For example, annual coverage"
                aria-invalid={invalidQuery}
                aria-describedby={`document-search-help${invalidQuery ? " document-search-error" : ""}`}
                onChange={(event) => setInput(event.target.value)}
              />
              <p id="document-search-help">
                Up to 200 characters. Multiple search words must match within a
                passage.
              </p>
            </div>
            {invalidQuery && (
              <p id="document-search-error" className="field-error" role="alert">
                Use at most 200 characters without control characters.
              </p>
            )}
            <div className="kb-search-options">
              <label htmlFor="document-search-limit">
                Maximum passages
                <select
                  id="document-search-limit"
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
              </label>
              <button
                className="request-secondary"
                type="button"
                onClick={resetSearch}
                disabled={!searching && !input}
              >
                All documents
              </button>
            </div>
            <p className="kb-help kb-search-note">
              Only successfully indexed text appears in search. Image-only PDFs
              and documents with processing issues remain in your library.
            </p>
          </div>
        </section>
      </div>
      {feedback && (
        <p className="request-feedback" role="status">
          {feedback}
        </p>
      )}
      <p className="request-announcement" role="status" aria-atomic="true">
        {invalidQuery
          ? ""
          : searching
            ? waiting
              ? "Waiting for your search…"
              : search.isPending || search.isFetching
                ? "Searching document text…"
                : searchData
                  ? `${searchData.results.length} matching ${searchData.results.length === 1 ? "passage" : "passages"} loaded.`
                  : ""
            : list.isPending
              ? "Loading documents…"
              : busy
                ? "Updating documents…"
                : documents
                  ? `${documents.total} ${documents.total === 1 ? "document" : "documents"} loaded.`
                  : ""}
      </p>
      <section
        className="dashboard-panel kb-results"
        aria-label={searching ? "Document search results" : "Document library"}
        aria-busy={busy}
      >
        <div className="panel-heading">
          <h2>{searching ? "Matching passages" : "Document library"}</h2>
          <span className="request-sort">
            {searching ? "Most relevant first" : "Newest first"}
          </span>
        </div>
        {searching ? (
          <>
            {invalidQuery ? (
              <p className="request-unavailable">
                Adjust the query to search PDF content.
              </p>
            ) : waiting || search.isPending ? (
              <div className="request-loading">
                <span className="loading-spinner" aria-hidden="true" />
                <p>
                  {waiting
                    ? "Preparing your search…"
                    : "Finding matching passages…"}
                </p>
              </div>
            ) : search.isError ? (
              <div className="dashboard-notice error-notice" role="alert">
                <div>
                  <strong>Unable to search documents</strong>
                  <p>
                    Check your connection, then try again or return to all
                    documents.
                  </p>
                </div>
                <button
                  type="button"
                  className="dashboard-button"
                  onClick={() => {
                    void search.refetch();
                  }}
                >
                  Try search again
                </button>
              </div>
            ) : searchData?.results.length ? (
              <>
                <p className="kb-help kb-result-count">
                  Showing up to {limit} passages for “{searchData.query}”.
                  Results follow relevance order.
                </p>
                <ol className="kb-passages">
                  {searchData.results.map((passage) => (
                    <li key={passage.chunk_id}>
                      <div className="kb-passage-heading">
                        <Link
                          className="request-title-link"
                          to={`/knowledge-base/${passage.document_id}`}
                        >
                          {passage.document_title}
                        </Link>
                        <span className="kb-page">
                          Page {passage.page_number}
                        </span>
                      </div>
                      <p>{passage.text}</p>
                      <Link
                        className="kb-details-link"
                        to={`/knowledge-base/${passage.document_id}`}
                      >
                        View document details <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="empty-state request-empty">
                <span className="overview-symbol">
                  <Icon name="book" />
                </span>
                <h3>No matching passages.</h3>
                <p>
                  Try different words or check that the document is searchable.
                </p>
                <button
                  type="button"
                  className="dashboard-button"
                  onClick={resetSearch}
                >
                  Browse all documents
                </button>
              </div>
            )}
          </>
        ) : list.isPending || correctingPage ? (
          <div className="request-loading">
            <span className="loading-spinner" aria-hidden="true" />
            <p>Loading your document library…</p>
          </div>
        ) : list.isError ? (
          <div className="dashboard-notice error-notice" role="alert">
            <div>
              <strong>Unable to load documents</strong>
              <p>
                Check your connection and try again.
              </p>
            </div>
            <button
              type="button"
              className="dashboard-button"
              onClick={() => {
                void list.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : documents?.total === 0 ? (
          <div className="empty-state request-empty">
            <span className="overview-symbol">
              <Icon name="book" />
            </span>
            <h3>No documents yet.</h3>
            <p>Upload a fictional PDF to start your policy library.</p>
          </div>
        ) : documents ? (
          <DocumentList
            documents={documents.data}
            busy={remove.isPending}
            onDelete={(item) => {
              remove.reset();
              setSelected(item);
            }}
          />
        ) : null}
        {!searching && documents && !correctingPage && (
          <div className="request-pagination">
            <p>
              {documents.total} total{" "}
              {documents.total === 1 ? "document" : "documents"}
            </p>
            <nav aria-label="Document pagination">
              <button
                className="request-secondary"
                type="button"
                disabled={busy || page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {last}
              </span>
              <button
                className="request-secondary"
                type="button"
                disabled={busy || page >= last}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </nav>
          </div>
        )}
      </section>
      {selected && (
        <DeleteDocumentDialog
          item={selected}
          pending={remove.isPending}
          error={remove.error}
          onCancel={() => setSelected(undefined)}
          onDelete={() => {
            if (deleteLock.current || remove.isPending) return;
            deleteLock.current = true;
            remove.mutate(String(selected.id), {
              onSuccess: () => {
                setSelected(undefined);
                setFeedback("Document and indexed text deleted successfully.");
              },
              onSettled: () => {
                deleteLock.current = false;
              },
            });
          }}
        />
      )}
    </>
  );
}
