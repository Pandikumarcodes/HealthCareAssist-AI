import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { documentKeys, useDocumentMutations } from "./queries";

afterEach(() => vi.unstubAllGlobals());
const item = {
  id: 42,
  title: "Fictional policy",
  original_filename: "fictional.pdf",
  file_size: 20,
  content_type: "application/pdf",
  created_at: "2026-10-23T10:00:00Z",
  processing_status: "INDEXED",
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: true } },
  });
  const keys = [
    documentKeys.list(1),
    documentKeys.list(2),
    documentKeys.search("coverage", 10),
    documentKeys.search("annual", 20),
  ];
  for (const key of keys) client.setQueryData(key, { cached: "old content" });
  client.setQueryData(documentKeys.detail("42"), item);
  client.setQueryData(["requests"], { preserved: true });
  client.setQueryData(["dashboard", "summary"], { preserved: true });
  const hook = renderHook(useDocumentMutations, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, keys, ...hook };
}
it("resets all document lists/searches after upload while preserving unrelated caches", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: item }), { status: 201 }),
      ),
  );
  const { result, client, keys } = setup();
  await act(async () => {
    await result.current.upload.mutateAsync({
      file: new File(["fictional"], "fictional.pdf"),
    });
  });
  for (const key of keys) expect(client.getQueryData(key)).toBeUndefined();
  expect(client.getQueryData(documentKeys.detail("42"))).toEqual(item);
  expect(client.getQueryData(["requests"])).toEqual({ preserved: true });
  expect(client.getQueryData(["dashboard", "summary"])).toEqual({
    preserved: true,
  });
});
it("removes deleted detail and stale inactive passages, without invalidating requests or dashboard", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  const { result, client, keys } = setup();
  await act(async () => {
    await result.current.remove.mutateAsync("42");
  });
  for (const key of keys) expect(client.getQueryData(key)).toBeUndefined();
  expect(client.getQueryData(documentKeys.detail("42"))).toBeUndefined();
  expect(client.getQueryState(["requests"])?.isInvalidated).toBe(false);
  expect(client.getQueryState(["dashboard", "summary"])?.isInvalidated).toBe(
    false,
  );
});
it("overrides automatic mutation retry defaults for uploads and deletion", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = setup();
  await act(async () => {
    await expect(
      result.current.upload.mutateAsync({
        file: new File(["fictional"], "fictional.pdf"),
      }),
    ).rejects.toThrow("Offline");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    await expect(result.current.remove.mutateAsync("42")).rejects.toThrow(
      "Offline",
    );
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
