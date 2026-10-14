import { z } from "zod";
import { failure, jsonOk, parseQuery } from "@/server/api";
import { rateLimitResponse } from "@/server/rate-limit";
import { search } from "@/server/services/search";

const Query = z.object({ q: z.string().trim().min(2).max(50) });

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const query = parseQuery(request, Query);
  if (!query.ok) return query.response;
  try {
    return jsonOk(await search(query.data.q), 24 * 60 * 60);
  } catch (err) {
    return failure(err, "/api/search");
  }
}
