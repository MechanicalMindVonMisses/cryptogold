import { z } from "zod";
import { failure, jsonOk, parseQuery } from "@/server/api";
import { rateLimitResponse } from "@/server/rate-limit";
import { getFx } from "@/server/services/search";

const Query = z.object({ currency: z.literal("TRY") });

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const query = parseQuery(request, Query);
  if (!query.ok) return query.response;
  try {
    return jsonOk(await getFx(query.data.currency), 12 * 60 * 60);
  } catch (err) {
    return failure(err, "/api/fx");
  }
}
