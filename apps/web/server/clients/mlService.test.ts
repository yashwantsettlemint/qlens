import { describe, expect, it, vi } from "vitest";
import { getModels, retrain } from "./mlService";

function mockFetchCapturingHeaders(responseBody: unknown, ok = true) {
  const captured: { url?: string; headers?: Record<string, string> } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts: any) => {
      captured.url = url;
      captured.headers = opts?.headers;
      return { ok, status: ok ? 200 : 500, json: async () => responseBody } as any;
    }),
  );
  return captured;
}

describe("clients/mlService", () => {
  it("getModels calls /models with the company_id query param and internal-service headers", async () => {
    const captured = mockFetchCapturingHeaders({ duplicate: {}, delay: {} });
    const data = await getModels("company-a");
    expect(captured.url).toContain("/models?company_id=company-a");
    expect(data).toEqual({ duplicate: {}, delay: {} });
  });

  it("throws with the status code when ml-service returns a non-ok response", async () => {
    mockFetchCapturingHeaders({}, false);
    await expect(getModels("company-a")).rejects.toThrow(/500/);
  });

  it("retrain POSTs model_name and company_id in the body", async () => {
    const captured: { body?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: any) => {
        captured.body = opts.body;
        return { ok: true, status: 200, json: async () => ({ status: "trained" }) } as any;
      }),
    );
    await retrain("company-a", "delay");
    expect(JSON.parse(captured.body!)).toEqual({ model_name: "delay", company_id: "company-a" });
  });
});
