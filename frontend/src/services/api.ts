const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
let csrfToken = "";
const unauthorizedListeners = new Set<() => void>();
const activeRequests = new Set<AbortController>();
let sessionGeneration = 0;

export function setCsrfToken(token: string) {
  csrfToken = token;
}
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}
export function resetApiSession() {
  sessionGeneration++;
  csrfToken = "";
  for (const controller of activeRequests) controller.abort();
  activeRequests.clear();
}

export class ApiError extends Error {
  status: number;
  details: Record<string, string>;
  code?: string;
  constructor(
    status: number,
    details: Record<string, string> = {},
    code?: string,
  ) {
    super(`API request failed (${status})`);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export async function apiRequest(
  path: string,
  options: {
    method?: "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const { signal, method, body, timeoutMs = 10000 } = options;
  const multipart = body instanceof FormData;
  const controller = new AbortController();
  const generation = sessionGeneration;
  activeRequests.add(controller);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...(method ? { method } : {}),
      credentials: "same-origin",
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(timeoutMs),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        Accept: "application/json",
        ...(body === undefined || multipart
          ? {}
          : { "Content-Type": "application/json" }),
        ...(method && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: multipart ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const details: Record<string, string> = {};
      if (
        response.status === 400 &&
        typeof data === "object" &&
        data !== null &&
        "details" in data &&
        typeof data.details === "object" &&
        data.details !== null
      ) {
        for (const [key, value] of Object.entries(data.details))
          if (typeof value === "string") details[key] = value;
      }
      const code =
        typeof data === "object" &&
        data !== null &&
        "code" in data &&
        typeof data.code === "string" &&
        /^(?:ai|auth)_[a-z_]{1,40}$/.test(data.code)
          ? data.code
          : undefined;
      if (
        path === "/api/auth/me" &&
        response.status === 401 &&
        typeof data === "object" &&
        data !== null &&
        "csrf_token" in data &&
        typeof data.csrf_token === "string" &&
        generation === sessionGeneration
      )
        setCsrfToken(data.csrf_token);
      if (
        response.status === 401 &&
        !["/api/auth/me", "/api/auth/login"].includes(path) &&
        generation === sessionGeneration
      ) {
        for (const listener of unauthorizedListeners) listener();
      }
      throw new ApiError(response.status, details, code);
    }
    if (response.status === 204) return undefined;
    const data: unknown = await response.json();
    if (generation !== sessionGeneration)
      throw new DOMException("Session changed", "AbortError");
    return data;
  } finally {
    activeRequests.delete(controller);
  }
}

export function apiGet(path: string, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(path, { signal });
}
