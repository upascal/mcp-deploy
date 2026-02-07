import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTest } from "../test-runner";
import type { TestSpec } from "../types";

describe("runTest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseSpec: TestSpec = {
    url: "https://api.example.com/test",
    method: "GET",
    headers: { Authorization: "Bearer {{value}}" },
    success: [200],
    errors: { 401: "Invalid API key", 403: "Forbidden" },
  };

  describe("placeholder substitution", () => {
    it("substitutes {{value}} in URL and headers", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 200 })
      );

      await runTest(baseSpec, "my-key", {});

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          headers: { Authorization: "Bearer my-key" },
        })
      );
    });

    it("substitutes {{FIELD_KEY}} placeholders from allValues", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const spec: TestSpec = {
        url: "https://api.example.com/users/{{USER_ID}}/check",
        method: "GET",
        headers: { "X-Key": "{{value}}" },
        success: [200],
      };

      await runTest(spec, "the-key", { USER_ID: "123" });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/users/123/check",
        expect.objectContaining({
          headers: { "X-Key": "the-key" },
        })
      );
    });

    it("URL-encodes values in URL but not in headers", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const spec: TestSpec = {
        url: "https://api.example.com/search?key={{value}}",
        method: "GET",
        headers: { "X-Key": "{{value}}" },
        success: [200],
      };

      await runTest(spec, "a b+c", {});

      const [url, opts] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("https://api.example.com/search?key=a%20b%2Bc");
      expect((opts as RequestInit).headers).toEqual({ "X-Key": "a b+c" });
    });
  });

  describe("success/error status mapping", () => {
    it("returns success for matching status code", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const result = await runTest(baseSpec, "key", {});
      expect(result).toEqual({ success: true, message: "Connection successful" });
    });

    it("returns custom error for known error status", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 401 })
      );

      const result = await runTest(baseSpec, "bad-key", {});
      expect(result).toEqual({ success: false, error: "Invalid API key" });
    });

    it("returns generic error for unknown status", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const result = await runTest(baseSpec, "key", {});
      expect(result).toEqual({
        success: false,
        error: "API returned status 500",
      });
    });
  });

  describe("timeout", () => {
    it("returns timeout error when fetch takes too long", async () => {
      vi.mocked(fetch).mockImplementation(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            (opts as RequestInit).signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          })
      );

      vi.useFakeTimers();
      const promise = runTest(baseSpec, "key", {});
      vi.advanceTimersByTime(10_000);
      const result = await promise;
      vi.useRealTimers();

      expect(result).toEqual({
        success: false,
        error: "Connection timed out (10s)",
      });
    });
  });

  describe("network errors", () => {
    it("returns error message on fetch failure", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await runTest(baseSpec, "key", {});
      expect(result).toEqual({ success: false, error: "ECONNREFUSED" });
    });

    it("returns generic message for non-Error throws", async () => {
      vi.mocked(fetch).mockRejectedValue("something weird");

      const result = await runTest(baseSpec, "key", {});
      expect(result).toEqual({ success: false, error: "Connection failed" });
    });
  });
});
