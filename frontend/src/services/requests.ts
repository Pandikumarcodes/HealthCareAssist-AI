import { apiGet, apiRequest } from "./api";

export const requestStatuses = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
} as const;
export const requestCategories = {
  GENERAL: "General",
  COVERAGE: "Coverage",
  CLAIMS: "Claims",
  APPOINTMENT: "Appointment",
} as const;
export type RequestStatus = keyof typeof requestStatuses;
export type RequestCategory = keyof typeof requestCategories;

export interface SupportRequest {
  id: number;
  title: string;
  description: string;
  category: RequestCategory;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
}

export type RequestInput = Pick<
  SupportRequest,
  "title" | "description" | "category"
>;
export type RequestUpdate = Partial<
  RequestInput & Pick<SupportRequest, "status">
>;

function unwrapRequest(body: unknown): SupportRequest {
  if (!isObject(body) || !isRequest(body.data))
    throw new Error("Unexpected support request response");
  return body.data;
}

export async function getRequest(
  id: string,
  signal?: AbortSignal,
): Promise<SupportRequest> {
  return unwrapRequest(
    await apiGet(`/api/requests/${encodeURIComponent(id)}`, signal),
  );
}

export async function createRequest(
  input: RequestInput,
): Promise<SupportRequest> {
  return unwrapRequest(
    await apiRequest("/api/requests", { method: "POST", body: input }),
  );
}

export async function updateRequest(
  id: string,
  input: RequestUpdate,
): Promise<SupportRequest> {
  return unwrapRequest(
    await apiRequest(`/api/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

export async function deleteRequest(id: string): Promise<void> {
  await apiRequest(`/api/requests/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface RequestFilters {
  status?: RequestStatus;
  category?: RequestCategory;
  q?: string;
}

export interface RequestListParameters extends RequestFilters {
  page: number;
  page_size: number;
}

export interface RequestPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface RequestListResponse extends RequestPagination {
  data: SupportRequest[];
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.endsWith("Z") &&
  Number.isFinite(Date.parse(value));

function isRequest(value: unknown): value is SupportRequest {
  return (
    isObject(value) &&
    isCount(value.id) &&
    value.id > 0 &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.description === "string" &&
    typeof value.category === "string" &&
    Object.hasOwn(requestCategories, value.category) &&
    typeof value.status === "string" &&
    Object.hasOwn(requestStatuses, value.status) &&
    isTimestamp(value.created_at) &&
    isTimestamp(value.updated_at)
  );
}

export async function getRequests(
  parameters: RequestListParameters,
  signal?: AbortSignal,
): Promise<RequestListResponse> {
  const query = new URLSearchParams({
    page: String(parameters.page),
    page_size: String(parameters.page_size),
  });
  if (parameters.status) query.set("status", parameters.status);
  if (parameters.category) query.set("category", parameters.category);
  if (parameters.q?.trim()) query.set("q", parameters.q.trim());
  const body = await apiGet(`/api/requests?${query}`, signal);
  if (
    !isObject(body) ||
    !Array.isArray(body.data) ||
    !body.data.every(isRequest) ||
    !isCount(body.page) ||
    body.page !== parameters.page ||
    !isCount(body.page_size) ||
    body.page_size !== parameters.page_size ||
    !isCount(body.total) ||
    !isCount(body.total_pages) ||
    body.total_pages !== Math.ceil(body.total / body.page_size) ||
    body.data.length !==
      Math.min(
        body.page_size,
        Math.max(0, body.total - (body.page - 1) * body.page_size),
      )
  ) {
    throw new Error("Unexpected support requests response");
  }
  return body as unknown as RequestListResponse;
}
