import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getSession, login, logout, sessionKey } from "../../services/auth";
import { AuthContext, useAuth } from "./auth-context";
import { onUnauthorized, resetApiSession } from "../../services/api";
import "./auth.css";

export function AuthBoundary() {
  const client = useQueryClient();
  const [boundaryStartedAt] = useState(() => Date.now());
  const hadSession = useRef(false);
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => getSession(signal),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const clearPrivateState = useCallback(() => {
    hadSession.current = false;
    resetApiSession();
    void client.cancelQueries();
    client.removeQueries({ predicate: (item) => item.queryKey[0] !== "auth" });
    client.getMutationCache().clear();
    client.setQueryData(sessionKey, null);
  }, [client]);
  const expire = useCallback(() => {
    clearPrivateState();
    // Bootstrap a new anonymous CSRF token; failed mutations are never retried.
    void client.invalidateQueries({ queryKey: sessionKey });
  }, [client, clearPrivateState]);
  useEffect(() => onUnauthorized(expire), [expire]);
  useEffect(() => {
    if (query.data) hadSession.current = true;
    else if (query.data === null && hadSession.current) expire();
  }, [query.data, expire]);
  useEffect(() => {
    if (!query.data) return;
    const remaining = query.data.expires_at * 1000 - Date.now();
    const timer = window.setTimeout(expire, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [query.data, expire]);
  if (
    query.isPending ||
    (!query.data && query.isFetching) ||
    (query.data && query.data.expires_at * 1000 <= boundaryStartedAt)
  )
    return (
      <main className="auth-status" role="status">
        Checking your session...
      </main>
    );
  if (query.isError)
    return (
      <main className="auth-status">
        <h1>Sign-in unavailable</h1>
        <p role="alert">Unable to verify your session. Please try again.</p>
        <button
          onClick={() => {
            void query.refetch();
          }}
        >
          Try again
        </button>
      </main>
    );
  return (
    <AuthContext.Provider
      value={{
        session: query.data ?? null,
        signIn: async (username, password) => {
          const session = await login(username, password);
          client.removeQueries({
            predicate: (item) => item.queryKey[0] !== "auth",
          });
          client.getMutationCache().clear();
          client.setQueryData(sessionKey, session);
        },
        signOut: async () => {
          await logout();
          clearPrivateState();
          void client.invalidateQueries({ queryKey: sessionKey });
        },
      }}
    >
      <Outlet />
    </AuthContext.Provider>
  );
}

export function ProtectedRoute() {
  const { session } = useAuth();
  const location = useLocation();
  return session ? (
    <Outlet />
  ) : (
    <Navigate
      to="/login"
      replace
      state={{ from: location.pathname + location.search + location.hash }}
    />
  );
}
