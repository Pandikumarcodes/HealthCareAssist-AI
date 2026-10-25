import { Link, NavLink } from "react-router-dom";
import { Icon } from "./Icon";
import { useRef, useState } from "react";
import { useAuth } from "../../features/auth/auth-context";

export function Sidebar({
  open,
  onNavigate,
}: {
  open: boolean;
  onNavigate: () => void;
}) {
  const { signOut } = useAuth();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  return (
    <aside
      id="workspace-navigation"
      className={`dashboard-sidebar${open ? " is-open" : ""}`}
    >
      <Link
        className="dashboard-brand"
        to="/"
        onClick={onNavigate}
        aria-label="HealthCareAssist AI home"
      >
        <span className="dashboard-brand-mark" aria-hidden="true">
          +
        </span>
        <span>
          HealthCareAssist<span className="brand-subtitle">AI WORKSPACE</span>
        </span>
      </Link>
      <nav aria-label="Workspace">
        <p className="nav-label">Workspace</p>
        <NavLink className="nav-item" to="/dashboard" onClick={onNavigate}>
          <Icon name="grid" />
          <span>Dashboard</span>
        </NavLink>
        <NavLink className="nav-item" to="/requests" onClick={onNavigate}>
          <Icon name="requests" />
          <span>Support Requests</span>
        </NavLink>
        <NavLink className="nav-item" to="/knowledge-base" onClick={onNavigate}>
          <Icon name="book" />
          <span>Knowledge Base</span>
        </NavLink>
        <NavLink className="nav-item" to="/ai-assistant" onClick={onNavigate}>
          <Icon name="sparkles" />
          <span>AI Assistant</span>
        </NavLink>
      </nav>
      <div className="sidebar-bottom">
        <button
          className="logout-button"
          disabled={pending}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setPending(true);
            setFailure(false);
            try {
              await signOut();
            } catch {
              setFailure(true);
            } finally {
              lock.current = false;
              setPending(false);
            }
          }}
        >
          <Icon name="logout" />
          {pending ? "Signing out..." : "Logout"}
        </button>
        {failure && (
          <p className="logout-error" role="alert">
            Unable to sign out. Please try again.
          </p>
        )}
        {/* <p className="sidebar-version">Fictional data · Portfolio demo</p> */}
      </div>
    </aside>
  );
}
