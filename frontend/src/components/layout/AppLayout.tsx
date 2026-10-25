import { useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Icon } from "./Icon";
import { Sidebar } from "./Sidebar";
import "../../features/dashboard/dashboard.css";

export function AppLayout() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const pathname = useLocation().pathname;
  const main = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    main.current?.focus();
  }, [pathname]);
  const pageTitle = pathname.startsWith("/requests")
    ? "Support Requests"
    : pathname.startsWith("/knowledge-base")
      ? "Knowledge Base"
      : pathname.startsWith("/ai-assistant")
        ? "AI Assistant"
        : "Dashboard";

  return (
    <div
      className="dashboard-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape" && navigationOpen) {
          setNavigationOpen(false);
          menu.current?.focus();
        }
      }}
    >
      <a className="skip-link" href="#dashboard-main">
        Skip to main content
      </a>
      <header className="mobile-header">
        <span className="mobile-brand">
          <span aria-hidden="true">+</span> HealthCareAssist AI
        </span>
        <button
          ref={menu}
          className="menu-toggle"
          type="button"
          aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navigationOpen}
          aria-controls="workspace-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <Icon name={navigationOpen ? "close" : "menu"} />
        </button>
      </header>
      <Sidebar
        open={navigationOpen}
        onNavigate={() => setNavigationOpen(false)}
      />
      <div className="dashboard-workspace">
        <header className="workspace-header">
          <span>
            Workspace <span aria-hidden="true">/</span>{" "}
            <strong>{pageTitle}</strong>
          </span>
          <span className="workspace-label">
            <span className="workspace-dot" /> Support workspace
          </span>
        </header>
        <main
          ref={main}
          id="dashboard-main"
          className="dashboard-main"
          tabIndex={-1}
        >
          <Outlet />
        </main>
        <footer className="dashboard-footer">
          <span>HealthCareAssist AI</span>
          <span>Built for better healthcare support.</span>
        </footer>
      </div>
    </div>
  );
}
