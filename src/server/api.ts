// Shared helpers for route handlers: validation, uniform error envelopes and Cache-Control headers.

import { z } from "zod";
import type { ApiErrorBody } from "@/lib/types";
import { ConfigError } from "./config";
import { UpstreamError } from "./http";
import { StorageError } from "./store/price-store";

export function cacheControl(seconds: number): string {
  return `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=${seconds}`;
}

export function jsonOk(body: unknown, maxAgeSeconds: number): Response {
  return Response.json(body, { headers: { "Cache-Control": cacheControl(maxAgeSeconds) } });
}

export function jsonError(status: number, error: string, source: string): Response {
  const body: ApiErrorBody = { error, source };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Validates the query string; returns the parsed value or a ready-to-send 400 response. */
export function parseQuery<T extends z.ZodType>(
  request: Request,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; response: Response } {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) return { ok: false, response: jsonError(400, "invalid_request", "request") };
  return { ok: true, data: parsed.data };
}

/**
 * Maps failures to the error envelope. Upstream error bodies, headers and keys are never forwarded;
 * only the failing source name is reported.
 */
export function failure(err: unknown, route: string): Response {
  if (err instanceof ConfigError) {
    console.error(err.message);
    return jsonError(500, "server_misconfigured", "config");
  }
  if (err instanceof StorageError) {
    console.error(`[auratio] ${route}: ${err.message}`);
    return jsonError(500, "storage_unavailable", "storage");
  }
  if (err instanceof UpstreamError) {
    console.warn(`[auratio] ${route}: ${err.message}`);
    if (err.status === 404) return jsonError(404, "not_found", err.source);
    return jsonError(502, err.rateLimited ? "rate_limited" : "upstream_unavailable", err.source);
  }
  console.error(`[auratio] ${route}: unexpected error`, err instanceof Error ? err.message : err);
  return jsonError(500, "internal_error", "server");
}
