import { Link } from "react-router-dom";
import { ApiError } from "../../services/api";

export function RequestLoadState({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: unknown;
  retry: () => void;
}) {
  return (
    <>
      <Link className="text-link request-back" to="/requests">
        Back to Requests
      </Link>
      {pending ? (
        <div role="status" className="dashboard-notice loading-notice">
          <span className="loading-spinner" />
          Loading request…
        </div>
      ) : error instanceof ApiError && error.status === 404 ? (
        <section className="dashboard-panel request-state">
          <h1>Request not found</h1>
          <p>This request may have been deleted or the link is incorrect.</p>
        </section>
      ) : (
        <div className="dashboard-notice error-notice" role="alert">
          <div>
            <strong>Unable to load request</strong>
            <p>Check your connection and try again.</p>
          </div>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}
