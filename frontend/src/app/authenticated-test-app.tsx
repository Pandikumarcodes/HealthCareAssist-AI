// Feature tests start with the result of a verified fictional session. Auth tests
// use the real App with an empty cache and mock the complete HTTP login flow.
import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import App from "../App";
import { sessionKey } from "../services/auth";
import { setCsrfToken } from "../services/api";

export default function AuthenticatedTestApp() {
  const [client] = useState(() => {
    const value = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 60_000,
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });
    value.setQueryData(sessionKey, {
      user: { id: "demo", display_name: "Demo User" },
      csrf_token: "synthetic-feature-csrf",
      expires_at: Date.now() / 1000 + 28800,
    });
    setCsrfToken("synthetic-feature-csrf");
    return value;
  });
  return <App client={client} />;
}
