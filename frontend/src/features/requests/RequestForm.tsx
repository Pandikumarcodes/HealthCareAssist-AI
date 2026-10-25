import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../services/api";
import { requestCategories } from "../../services/requests";
import type { RequestInput, RequestCategory } from "../../services/requests";

type FormValues = Omit<RequestInput, "category"> & {
  category: RequestCategory | "";
};
type Errors = Partial<Record<keyof RequestInput, string>>;
const blank: FormValues = { title: "", description: "", category: "" };
const serverMessages = new Set([
  "This field is required.",
  "Must be a nonblank string.",
  "Must not contain null characters.",
  "Must be at most 200 characters.",
  "Must be GENERAL, COVERAGE, CLAIMS, or APPOINTMENT.",
]);

function validateRequest(values: FormValues): Errors {
  const errors: Errors = {};
  for (const key of ["title", "description"] as const) {
    if (!values[key].trim())
      errors[key] = `${key === "title" ? "Title" : "Description"} is required.`;
    else if (values[key].includes("\0"))
      errors[key] = "Must not contain null characters.";
  }
  // Python counts Unicode code points, rather than JavaScript UTF-16 units.
  if (Array.from(values.title.trim()).length > 200)
    errors.title = "Title must be at most 200 characters.";
  if (!Object.hasOwn(requestCategories, values.category))
    errors.category = "Choose a category.";
  return errors;
}

export function RequestForm({
  initial,
  pending,
  onSave,
  cancelTo,
}: {
  initial?: RequestInput;
  pending: boolean;
  onSave: (input: RequestInput) => Promise<void>;
  cancelTo: string;
}) {
  const [values, setValues] = useState<FormValues>(initial ?? blank);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState("");
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const focusError = (next: Errors) => {
    const key = (Object.keys(next) as (keyof RequestInput)[])[0];
    if (key)
      (form.current?.elements.namedItem(key) as HTMLElement | null)?.focus();
  };
  return (
    <form
      className="dashboard-panel request-form"
      ref={form}
      noValidate
      onChange={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          if (["title", "description", "category"].includes(target.name))
            setErrors((current) => ({ ...current, [target.name]: undefined }));
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || pending) return;
        const next = validateRequest(values);
        setErrors(next);
        setFailure("");
        if (Object.keys(next).length) {
          focusError(next);
          return;
        }
        lock.current = true;
        try {
          await onSave({
            title: values.title.trim(),
            description: values.description.trim(),
            category: values.category as RequestCategory,
          });
        } catch (error) {
          const fields: Errors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const key of ["title", "description", "category"] as const) {
              const message = error.details[key];
              if (message)
                fields[key] = serverMessages.has(message)
                  ? message
                  : "Check this value and try again.";
            }
          }
          setErrors(fields);
          setFailure(
            error instanceof ApiError && error.status === 404
              ? "This request no longer exists. Return to Requests to continue."
              : "Unable to save request. Check your connection and values, then try again.",
          );
          focusError(fields);
        } finally {
          lock.current = false;
        }
      }}
    >
      <div className="panel-heading">
        <h2>{initial ? "Edit request information" : "Request information"}</h2>
        <span className="request-sort">All fields required</span>
      </div>
      <div className="request-form-body">
        {failure && (
          <p className="dashboard-notice error-notice" role="alert">
            {failure}
          </p>
        )}
        <fieldset disabled={pending}>
          <div className="request-field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              name="title"
              required
              value={values.title}
              aria-invalid={!!errors.title}
              aria-describedby={`title-help${errors.title ? " title-error" : ""}`}
              onChange={(e) => setValues({ ...values, title: e.target.value })}
            />
            <p id="title-help">
              Up to 200 characters, excluding surrounding spaces.
            </p>
            {errors.title && (
              <p id="title-error" className="field-error">
                {errors.title}
              </p>
            )}
          </div>
          <div className="request-field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              required
              rows={7}
              value={values.description}
              aria-invalid={!!errors.description}
              aria-describedby={
                errors.description ? "description-error" : undefined
              }
              onChange={(e) =>
                setValues({ ...values, description: e.target.value })
              }
            />
            {errors.description && (
              <p id="description-error" className="field-error">
                {errors.description}
              </p>
            )}
          </div>
          <div className="request-field">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              name="category"
              required
              value={values.category}
              aria-invalid={!!errors.category}
              aria-describedby={errors.category ? "category-error" : undefined}
              onChange={(e) =>
                setValues({
                  ...values,
                  category: e.target.value as FormValues["category"],
                })
              }
            >
              <option value="">Select a category</option>
              {Object.entries(requestCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.category && (
              <p id="category-error" className="field-error">
                {errors.category}
              </p>
            )}
          </div>
        </fieldset>
        <div className="request-actions">
          <button type="submit" disabled={pending}>
            {pending
              ? "Saving request…"
              : initial
                ? "Save changes"
                : "Create request"}
          </button>
          {!pending && (
            <Link
              className="request-secondary request-action-link"
              to={cancelTo}
            >
              Cancel
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
