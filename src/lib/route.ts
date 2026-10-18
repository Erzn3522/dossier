import "server-only";

import { unstable_rethrow } from "next/navigation";
import { type NextRequest, NextResponse } from "next/server";

import { getSession, type Session } from "@/lib/auth/session";
import { logServerError } from "@/lib/log";
import { messages } from "@/lib/messages";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The host the browser used: `X-Forwarded-Host` from the reverse proxy, otherwise `Host`. */
function requestHost(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (forwarded || headers.get("host"))?.toLowerCase();
}

/**
 * Whether a request came from this app's own pages, the same check Next.js
 * runs for Server Actions. Browsers send `Origin` with every POST, PUT, PATCH
 * and DELETE, so a state-changing request without one is refused.
 */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const origin = request.headers.get("origin");
  if (origin === null) return SAFE_METHODS.has(request.method);

  let originHost: string;
  try {
    originHost = new URL(origin).host; // throws for the opaque origin "null"
  } catch {
    return false;
  }
  return originHost.toLowerCase() === requestHost(request.headers);
}

/**
 * Defines a route handler that changes state or returns private data (PDFs,
 * imports, job progress). It refuses cross-origin requests (403) and requests
 * without a session (401), and turns unexpected errors into a logged, generic
 * 500. Responses default to `Cache-Control: private, no-store`.
 *
 *     export const GET = route<RouteContext<"/api/pdf/[id]">>(
 *       async (request, { params }) => { ... },
 *     );
 */
export function route<Context = unknown>(
  handler: (
    request: NextRequest,
    context: Context,
    session: Session,
  ) => Promise<Response>,
  options: { allowCrossSiteGet?: boolean } = {},
): (request: NextRequest, context: Context) => Promise<Response> {
  return async (request, context) => {
    const allowedOAuthReturn = options.allowCrossSiteGet === true && request.method === "GET";
    if (!allowedOAuthReturn && !isSameOrigin(request)) {
      return NextResponse.json({ error: messages.crossOrigin }, { status: 403 });
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: messages.signedOut }, { status: 401 });
    }

    let response: Response;
    try {
      response = await handler(request, context, session);
    } catch (error) {
      unstable_rethrow(error);
      logServerError(`${request.method} ${request.nextUrl.pathname}`, error);
      response = NextResponse.json({ error: messages.unexpected }, { status: 500 });
    }
    if (!response.headers.has("cache-control")) {
      try {
        response.headers.set("cache-control", "private, no-store");
      } catch {
        // Some responses (e.g. Response.redirect) have immutable headers.
      }
    }
    return response;
  };
}
