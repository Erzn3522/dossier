import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "./auth/session";
import { messages } from "./messages";
import { isSameOrigin, route } from "./route";

vi.mock("./auth/session", () => ({ getSession: vi.fn() }));

const session = { persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };

function request(method: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/test", {
    method,
    headers: { host: "localhost:3000", ...headers },
  });
}

describe("isSameOrigin", () => {
  it("accepts a POST from the app's own origin", () => {
    expect(isSameOrigin(request("POST", { origin: "http://localhost:3000" }))).toBe(true);
  });

  it("uses X-Forwarded-Host behind a reverse proxy", () => {
    const behindProxy = request("POST", {
      origin: "https://dossier.example.com",
      "x-forwarded-host": "dossier.example.com",
    });
    expect(isSameOrigin(behindProxy)).toBe(true);
  });

  it("refuses a POST from another origin", () => {
    expect(isSameOrigin(request("POST", { origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(request("POST", { origin: "http://localhost:4000" }))).toBe(false);
    expect(isSameOrigin(request("POST", { origin: "null" }))).toBe(false);
  });

  it("refuses a state-changing request without an Origin header", () => {
    expect(isSameOrigin(request("DELETE"))).toBe(false);
  });

  it("accepts a GET without an Origin header, such as a download link", () => {
    expect(isSameOrigin(request("GET"))).toBe(true);
    expect(isSameOrigin(request("GET", { "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("refuses requests the browser marks as coming from another site", () => {
    expect(isSameOrigin(request("GET", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(request("GET", { "sec-fetch-site": "same-site" }))).toBe(false);
  });
});

describe("route", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(session);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ok = route(async () => Response.json({ hello: "world" }));

  it("runs the handler and marks the response private", async () => {
    const response = await ok(request("GET"), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps a Cache-Control header set by the handler", async () => {
    const cached = route(
      async () => new Response("x", { headers: { "cache-control": "max-age=60" } }),
    );
    const response = await cached(request("GET"), undefined);
    expect(response.headers.get("cache-control")).toBe("max-age=60");
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await ok(request("POST", { origin: "https://evil.example" }), undefined);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: messages.crossOrigin });
  });

  it("can allow a cross-site OAuth return without allowing cross-site writes", async () => {
    const oauthReturn = route(async () => Response.json({ ok: true }), { allowCrossSiteGet: true });
    const get = await oauthReturn(request("GET", { "sec-fetch-site": "cross-site" }), undefined);
    expect(get.status).toBe(200);
    const post = await oauthReturn(request("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), undefined);
    expect(post.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await ok(request("GET"), undefined);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: messages.signedOut });
  });

  it("returns a generic 500 when the handler fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = route(async () => {
      throw new Error("boom");
    });
    const response = await failing(request("GET"), undefined);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: messages.unexpected });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[GET /api/test] Error: boom"));
  });

  it("passes the route context through", async () => {
    const withParams = route<{ params: Promise<{ id: string }> }>(async (_, { params }) =>
      Response.json(await params),
    );
    const response = await withParams(request("GET"), { params: Promise.resolve({ id: "42" }) });
    expect(await response.json()).toEqual({ id: "42" });
  });
});
