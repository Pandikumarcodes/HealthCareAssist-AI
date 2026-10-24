import { ApiError, apiGet, apiRequest, setCsrfToken } from "./api";

export type DemoSession = {
  user: { id: "demo"; display_name: string };
  csrf_token: string;
  expires_at: number;
};
export const sessionKey = ["auth", "session"] as const;

function parseSession(data: unknown): DemoSession {
  if (
    typeof data !== "object" ||
    data === null ||
    !("user" in data) ||
    typeof data.user !== "object" ||
    data.user === null ||
    !("id" in data.user) ||
    data.user.id !== "demo" ||
    !("display_name" in data.user) ||
    typeof data.user.display_name !== "string" ||
    !("csrf_token" in data) ||
    typeof data.csrf_token !== "string" ||
    !data.csrf_token ||
    !("expires_at" in data) ||
    typeof data.expires_at !== "number" ||
    !Number.isFinite(data.expires_at)
  )
    throw new Error("Invalid session response");
  setCsrfToken(data.csrf_token);
  return data as DemoSession;
}

export async function getSession(
  signal?: AbortSignal,
): Promise<DemoSession | null> {
  try {
    return parseSession(await apiGet("/api/auth/me", signal));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export async function login(
  username: string,
  password: string,
): Promise<DemoSession> {
  return parseSession(
    await apiRequest("/api/auth/login", {
      method: "POST",
      body: { username, password },
    }),
  );
}
export async function logout() {
  await apiRequest("/api/auth/logout", { method: "POST" });
}
