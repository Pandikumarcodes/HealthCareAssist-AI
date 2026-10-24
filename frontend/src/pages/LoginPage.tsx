import { useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../services/api";
import { useAuth } from "../features/auth/auth-context";
import {
  hasControlCharacters,
  safeDestination,
} from "../features/auth/validation";

export function LoginPage() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const destination = safeDestination(
    (location.state as { from?: unknown } | null)?.from,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{
    username?: string;
    password?: string;
  }>({});
  const [failure, setFailure] = useState("");
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  if (session) return <Navigate to={destination} replace />;
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="brand" to="/" aria-label="HealthCareAssist AI home">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>
            HealthCareAssist <span className="brand-ai">AI</span>
          </span>
        </Link>
        <p className="eyebrow">Fictional data · Portfolio demo</p>
        <h1 id="login-title">Welcome back</h1>
        <p className="login-description">
          Sign in to explore the healthcare support demo.
        </p>
        <form
          ref={form}
          noValidate
          aria-label="Demo sign in"
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current) return;
            const next = {
              ...(!username.trim()
                ? { username: "Username is required." }
                : Array.from(username.trim()).length > 100 ||
                    hasControlCharacters(username)
                  ? {
                      username:
                        "Enter a valid username of up to 100 characters.",
                    }
                  : {}),
              ...(!password
                ? { password: "Password is required." }
                : Array.from(password).length > 1024 || password.includes("\0")
                  ? {
                      password:
                        "Enter a valid password of up to 1024 characters.",
                    }
                  : {}),
            };
            setErrors(next);
            setFailure("");
            if (Object.keys(next).length) {
              (
                form.current?.elements.namedItem(
                  next.username ? "username" : "password",
                ) as HTMLElement | null
              )?.focus();
              return;
            }
            lock.current = true;
            setPending(true);
            try {
              await signIn(username.trim(), password);
              setPassword("");
            } catch (error) {
              setPassword("");
              setFailure(
                error instanceof ApiError && error.status === 401
                  ? "Invalid username or password."
                  : error instanceof ApiError && error.status === 403
                    ? "Security check failed. Refresh this page and try again."
                    : "Sign-in is unavailable. Please try again shortly.",
              );
            } finally {
              lock.current = false;
              setPending(false);
            }
          }}
        >
          {failure && (
            <p className="login-error" role="alert">
              {failure}
            </p>
          )}
          <fieldset disabled={pending}>
            <div className="request-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                required
                value={username}
                aria-invalid={!!errors.username}
                aria-describedby={
                  errors.username ? "username-error" : undefined
                }
                onChange={(e) => {
                  setUsername(e.target.value);
                  setErrors((value) => ({ ...value, username: undefined }));
                }}
              />
              {errors.username && (
                <p id="username-error" className="field-error">
                  {errors.username}
                </p>
              )}
            </div>
            <div className="request-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((value) => ({ ...value, password: undefined }));
                }}
              />
              {errors.password && (
                <p id="password-error" className="field-error">
                  {errors.password}
                </p>
              )}
            </div>
          </fieldset>
          <button type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="login-note">
          Use the demo credentials shared with you. Explore with fictional
          information only.
        </p>
      </section>
    </main>
  );
}
