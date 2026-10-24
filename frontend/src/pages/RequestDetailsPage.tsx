import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { RequestLoadState } from "../features/requests/RequestLoadState";
import { useRequest, useRequestMutations } from "../features/requests/queries";
import { StatusBadge } from "../features/requests/RequestList";
import { ApiError } from "../services/api";
import { requestCategories, requestStatuses } from "../services/requests";
import type { RequestStatus, SupportRequest } from "../services/requests";
import "../features/requests/requests.css";

function DeleteDialog({
  item,
  pending,
  error,
  onCancel,
  onDelete,
}: {
  item: SupportRequest;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className="request-dialog"
      aria-labelledby="delete-title"
      aria-describedby="delete-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          ) ?? [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.current?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id="delete-title">Delete request #{item.id}?</h2>
      <p className="delete-request-title">{item.title}</p>
      <p id="delete-description">
        This permanently deletes this support request. This action cannot be
        undone.
      </p>
      {!!error && (
        <p role="alert" className="field-error">
          {error instanceof ApiError && error.status === 404
            ? "This request was already deleted. Return to Requests to continue."
            : "Unable to delete request. Check your connection and try again."}
        </p>
      )}
      <div className="request-actions">
        <button
          type="button"
          className="request-secondary"
          autoFocus
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="request-danger"
          disabled={pending}
          onClick={onDelete}
        >
          {pending ? "Deleting…" : "Delete request"}
        </button>
      </div>
      {error instanceof ApiError && error.status === 404 && (
        <Link className="text-link" to="/requests">
          Back to Requests
        </Link>
      )}
    </dialog>
  );
}

function StatusForm({
  item,
  pending,
  onSave,
}: {
  item: SupportRequest;
  pending: boolean;
  onSave: (status: RequestStatus) => void;
}) {
  const [status, setStatus] = useState(item.status);
  return (
    <form
      className="request-status-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending && status !== item.status) onSave(status);
      }}
    >
      <label htmlFor="change-status">Request status</label>
      <div className="request-actions">
        <select
          id="change-status"
          value={status}
          disabled={pending}
          onChange={(e) => setStatus(e.target.value as RequestStatus)}
        >
          {Object.entries(requestStatuses).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending || status === item.status}>
          {pending ? "Saving status…" : "Save status"}
        </button>
      </div>
    </form>
  );
}

export function RequestDetailsPage() {
  const { id = "" } = useParams();
  const { update, remove } = useRequestMutations(id);
  const query = useRequest(id, !remove.isPending && !remove.isSuccess);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const statusLock = useRef(false);
  const deleteLock = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const routeFeedback =
    typeof location.state?.feedback === "string" ? location.state.feedback : "";
  const busy = update.isPending || remove.isPending;
  if (query.isPending || query.isError)
    return (
      <RequestLoadState
        pending={query.isPending}
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const item = query.data;
  return (
    <>
      <Link className="text-link request-back" to="/requests">
        Back to Requests
      </Link>
      <div className="dashboard-heading request-detail-heading">
        <div>
          <p className="dashboard-eyebrow">Support request #{item.id}</p>
          <h1>{item.title}</h1>
          <StatusBadge status={item.status} />
        </div>
        <div className="request-actions">
          {!busy && (
            <Link
              className="request-secondary request-action-link"
              to={`/requests/${id}/edit`}
            >
              Edit request
            </Link>
          )}
          <button
            type="button"
            className="request-danger"
            disabled={busy}
            onClick={() => {
              remove.reset();
              setConfirming(true);
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <p role="status" className="request-feedback">
        {feedback || routeFeedback}
      </p>
      <section
        className="dashboard-panel request-detail"
        aria-label="Request details"
      >
        <div className="panel-heading">
          <h2>Request details</h2>
        </div>
        <dl className="request-metadata">
          <div>
            <dt>Request ID</dt>
            <dd>#{item.id}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{requestCategories[item.category]}</dd>
          </div>
          <div>
            <dt>Created date</dt>
            <dd>
              <time dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString()}
              </time>
            </dd>
          </div>
          <div>
            <dt>Updated date</dt>
            <dd>
              <time dateTime={item.updated_at}>
                {new Date(item.updated_at).toLocaleString()}
              </time>
            </dd>
          </div>
        </dl>
        <div className="request-description">
          <h2>Description</h2>
          <p>{item.description}</p>
        </div>
        <StatusForm
          key={`${id}:${item.status}`}
          item={item}
          pending={busy}
          onSave={(status) => {
            if (statusLock.current || busy) return;
            statusLock.current = true;
            setFeedback("");
            update.mutate(
              { status },
              {
                onSuccess: () => setFeedback("Status updated successfully."),
                onSettled: () => {
                  statusLock.current = false;
                },
              },
            );
          }}
        />
        {update.isError && (
          <p role="alert" className="field-error request-status-error">
            {update.error instanceof ApiError && update.error.status === 404
              ? "This request no longer exists. Return to Requests to continue."
              : "Unable to update status. Check your connection and try again."}
          </p>
        )}
      </section>
      {confirming && (
        <DeleteDialog
          item={item}
          pending={remove.isPending}
          error={remove.error}
          onCancel={() => setConfirming(false)}
          onDelete={() => {
            if (deleteLock.current || remove.isPending) return;
            deleteLock.current = true;
            remove.mutate(undefined, {
              onSuccess: () =>
                navigate("/requests", {
                  replace: true,
                  state: { feedback: "Request deleted successfully." },
                }),
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
