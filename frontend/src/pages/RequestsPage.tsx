import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/layout/Icon";
import { RequestList } from "../features/requests/RequestList";
import {
  getRequests,
  requestCategories,
  requestStatuses,
} from "../services/requests";
import type {
  RequestCategory,
  RequestListParameters,
  RequestStatus,
} from "../services/requests";
import "../features/requests/requests.css";

const initialParameters: RequestListParameters = { page: 1, page_size: 20 };

export function RequestsPage() {
  const location = useLocation();
  const [parameters, setParameters] = useState(initialParameters);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const searchPending = search.trim() !== (parameters.q ?? "");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = search.trim();
      setParameters((current) =>
        (current.q ?? "") === q ? current : { ...current, page: 1, q },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data, isPending, isError, isFetching, isPlaceholderData, refetch } =
    useQuery({
      queryKey: ["requests", parameters],
      queryFn: async ({ signal }) => {
        const response = await getRequests(parameters, signal);
        const availablePage = Math.max(1, response.total_pages);
        if (parameters.page > availablePage) {
          // Refresh the recovery page even if an older copy is still cached.
          await queryClient.invalidateQueries({
            queryKey: ["requests", { ...parameters, page: availablePage }],
            exact: true,
          });
        }
        return response;
      },
      // Retain rows only when moving between pages of the same filtered list.
      placeholderData: (previous, previousQuery) => {
        const old = previousQuery?.queryKey[1] as
          | RequestListParameters
          | undefined;
        return old &&
          old.status === parameters.status &&
          old.category === parameters.category &&
          old.q === parameters.q &&
          old.page_size === parameters.page_size
          ? previous
          : undefined;
      },
    });
  const result = isError ? undefined : data;
  const lastPage = result ? Math.max(1, result.total_pages) : 1;
  const correctingPage =
    !!result && !isPlaceholderData && parameters.page > lastPage;

  // The server can report fewer pages after records disappear between loads.
  // Adjust once before rendering children, then fetch the last valid page.
  if (correctingPage) setParameters({ ...parameters, page: lastPage });

  const filtered = !!(parameters.q || parameters.status || parameters.category);
  const busy = isFetching || searchPending || correctingPage;
  const reset = () => {
    setSearch("");
    setParameters(initialParameters);
  };

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">Your support workspace</p>
          <h1>Support Requests</h1>
          <p>
            Browse healthcare support requests and find what needs your
            attention.
          </p>
        </div>
        <Link
          className="request-primary request-action-link"
          to="/requests/new"
        >
          New Request
        </Link>
      </div>
      {typeof location.state?.feedback === "string" && (
        <p className="request-feedback">{location.state.feedback}</p>
      )}
      <section
        className="dashboard-panel request-filters"
        aria-label="Search and filter requests"
      >
        <div className="request-search">
          <label htmlFor="request-search">Search requests</label>
          <div className="search-controls">
            <input
              id="request-search"
              type="search"
              placeholder="Search title or description"
              maxLength={200}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-describedby="request-search-help"
            />
            {search && (
              <button
                type="button"
                className="request-secondary"
                onClick={() => {
                  setSearch("");
                  setParameters((current) => ({ ...current, page: 1, q: "" }));
                }}
              >
                Clear search
              </button>
            )}
          </div>
          <p id="request-search-help">
            Search titles and descriptions. Up to 200 characters.
          </p>
        </div>
        <div>
          <label htmlFor="request-status">Status</label>
          <select
            id="request-status"
            value={parameters.status ?? ""}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                page: 1,
                status: (event.target.value as RequestStatus) || undefined,
              }))
            }
          >
            <option value="">All statuses</option>
            {Object.entries(requestStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="request-category">Category</label>
          <select
            id="request-category"
            value={parameters.category ?? ""}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                page: 1,
                category: (event.target.value as RequestCategory) || undefined,
              }))
            }
          >
            <option value="">All categories</option>
            {Object.entries(requestCategories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>
      <p role="status" className="request-announcement" aria-atomic="true">
        {isPending
          ? "Loading support requests…"
          : busy
            ? "Updating requests…"
            : result
              ? `${result.total.toLocaleString()} ${filtered ? "matching requests" : "requests"} loaded.${typeof location.state?.feedback === "string" ? ` ${location.state.feedback}` : ""}`
              : ""}
      </p>
      {isError && (
        <div className="dashboard-notice error-notice" role="alert">
          <div>
            <strong>Unable to load support requests</strong>
            <p>
              Check your connection and that the Flask backend is running, then
              try again. You can also clear or adjust your filters.
            </p>
          </div>
          <button
            type="button"
            className="dashboard-button"
            onClick={() => {
              void refetch();
            }}
          >
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )}
      <section
        className="dashboard-panel request-results"
        aria-label="Support request results"
        aria-busy={busy}
      >
        <div className="panel-heading">
          <h2>Request list</h2>
          <span className="request-sort">Newest first</span>
        </div>
        {isPending || correctingPage ? (
          <div className="request-loading" aria-hidden="true">
            <span className="loading-spinner" />
            <p>
              {correctingPage
                ? "Finding the last available page…"
                : "Loading your requests…"}
            </p>
          </div>
        ) : result ? (
          result.total === 0 ? (
            <div className="empty-state request-empty">
              <span className="overview-symbol">
                <Icon name="requests" />
              </span>
              <h3>
                {filtered
                  ? "No requests match your filters."
                  : "No support requests yet."}
              </h3>
              <p>
                {filtered
                  ? "Try another keyword, status, or category."
                  : "Support requests will appear here when they are available."}
              </p>
              {filtered && (
                <button
                  type="button"
                  className="dashboard-button"
                  onClick={reset}
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <RequestList requests={result.data} />
          )
        ) : (
          <p className="request-unavailable">
            The request list is unavailable. Retry to load your requests.
          </p>
        )}
        {result && !correctingPage && (
          <div className="request-pagination">
            <p>
              {result.total.toLocaleString()}{" "}
              {filtered ? "matching requests" : "total requests"}
            </p>
            <nav aria-label="Request pagination">
              <button
                className="request-secondary"
                type="button"
                disabled={busy || parameters.page <= 1}
                onClick={() =>
                  setParameters((current) => ({
                    ...current,
                    page: Math.max(1, current.page - 1),
                  }))
                }
              >
                Previous
              </button>
              <span>
                Page {isPlaceholderData ? parameters.page : result.page} of{" "}
                {Math.max(1, result.total_pages)}
              </span>
              <button
                className="request-secondary"
                type="button"
                disabled={busy || parameters.page >= lastPage}
                onClick={() =>
                  setParameters((current) => ({
                    ...current,
                    page: Math.min(lastPage, current.page + 1),
                  }))
                }
              >
                Next
              </button>
            </nav>
          </div>
        )}
      </section>
    </>
  );
}
