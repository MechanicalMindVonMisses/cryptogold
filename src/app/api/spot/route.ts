import { z } from "zod";
import { COIN_ID_PATTERN } from "@/lib/url-state";
import { failure, jsonOk, parseQuery } from "@/server/api";
import { rateLimitResponse } from "@/server/rate-limit";
import { getSpot } from "@/server/services/spot";

const MAX_SPOT_IDS = 20;

const Query = z.object({
  ids: z
    .string()
    .max(2_100)
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().regex(COIN_ID_PATTERN)).min(1).max(MAX_SPOT_IDS)),
});

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const query = parseQuery(request, Query);
  if (!query.ok) return query.response;
  try {
    const body = await getSpot(query.data.ids);
    return jsonOk(body, body.coinsStale || body.gold.stale ? 15 : 60);
  } catch (err) {
    return failure(err, "/api/spot");
  }
}
