"use client";

import { useState, useCallback, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Nav } from "@/components/nav";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Close mobile nav on route navigation
  useEffect(() => {
    const handler = () => setMobileNavOpen(false);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const toggleNav = useCallback(() => setMobileNavOpen((v) => !v), []);
  const toggleDetail = useCallback(() => setDetailOpen((v) => !v), []);

  return (
    <div className="app-shell">
      {/* Mobile overlay backdrop */}
      {mobileNavOpen && (
        <div className="nav-overlay" onClick={() => setMobileNavOpen(false)} />
      )}
      {detailOpen && (
        <div className="detail-overlay" onClick={() => setDetailOpen(false)} />
      )}

      {/* Hamburger toggle — visible on narrow screens */}
      <button
        className="nav-toggle"
        onClick={toggleNav}
        aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileNavOpen}
      >
        <span className="nav-toggle-icon">
          {mobileNavOpen ? "✕" : "☰"}
        </span>
      </button>

      {/* Navigation panel */}
      <ErrorBoundary
        fallback={
          <nav className="nav-panel">
            <div className="error-boundary-fallback error-boundary-fallback--compact">
              <p>Navigation unavailable</p>
              <button
                className="error-boundary-retry"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </nav>
        }
      >
        <div className={`nav-panel-wrapper ${mobileNavOpen ? "nav-visible" : ""}`}>
          <Nav />
        </div>
      </ErrorBoundary>

      {/* Main content */}
      <ErrorBoundary
        fallback={
          <main className="main-content">
            <div className="error-boundary-fallback">
              <div className="error-boundary-icon">⚠</div>
              <h3 className="error-boundary-title">Content unavailable</h3>
              <p className="error-boundary-message">
                This panel encountered an error. Other parts of the app are still working.
              </p>
              <button
                className="error-boundary-retry"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            </div>
          </main>
        }
      >
        <main className="main-content">{children}</main>
      </ErrorBoundary>

      {/* Detail panel toggle — visible on narrow screens */}
      <button
        className="detail-toggle"
        onClick={toggleDetail}
        aria-label={detailOpen ? "Close detail panel" : "Open detail panel"}
        aria-expanded={detailOpen}
      >
        <span className="detail-toggle-icon">
          {detailOpen ? "→" : "←"}
        </span>
      </button>

      {/* Detail panel (right sidebar) */}
      <ErrorBoundary
        fallback={
          <aside className="detail-panel">
            <div className="error-boundary-fallback error-boundary-fallback--compact">
              <p>Detail panel unavailable</p>
            </div>
          </aside>
        }
      >
        <aside
          className={`detail-panel ${detailOpen ? "detail-visible" : ""}`}
          id="detail-panel"
        />
      </ErrorBoundary>
    </div>
  );
}
