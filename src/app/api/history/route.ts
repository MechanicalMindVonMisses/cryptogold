import { z } from "zod";
import { RANGE_KEYS, RANGES } from "@/lib/ranges";
import { COIN_ID_PATTERN } from "@/lib/url-state";
import { failure, jsonOk, parseQuery } from "@/server/api";
import { rateLimitResponse } from "@/server/rate-limit";
import { getHistory } from "@/server/services/history";

const Query = z.object({
  id: z.string().regex(COIN_ID_PATTERN),
  range: z.enum(RANGE_KEYS),
});

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const query = parseQuery(request, Query);
  if (!query.ok) return query.response;
  try {
    const body = getHistory(query.data.id, query.data.range);
    // Recorded history grows every minute, so short ranges are cached only briefly.
    return jsonOk(body, RANGES[query.data.range].granularity === "day" ? 300 : 60);
  } catch (err) {
    return failure(err, "/api/history");
  }
}
