import { z } from "zod";

export const DEFAULT_BINANCE_BASE_URL = "https://api.binance.com";
export const ALT_BINANCE_BASE_URL = "https://data-api.binance.vision";
/** Recorded price history lives here unless AURATIO_DB_PATH says otherwise. */
export const DEFAULT_DB_PATH = "data/auratio.db";

const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const EnvSchema = z.object({
  FREECRYPTOAPI_KEY: z
    .string({ error: "FREECRYPTOAPI_KEY is not set" })
    .trim()
    .min(1, { error: "FREECRYPTOAPI_KEY is empty" }),
  COINGECKO_DEMO_API_KEY: optional,
  BINANCE_BASE_URL: z
    .url({ error: "BINANCE_BASE_URL must be an absolute URL" })
    .default(DEFAULT_BINANCE_BASE_URL)
    .transform((u) => u.replace(/\/+$/, "")),
  AURATIO_DB_PATH: z.string().trim().min(1).default(DEFAULT_DB_PATH),
  RECORDER: z.enum(["on", "off"], { error: 'RECORDER must be "on" or "off"' }).default("on"),
  RECORD_INTERVAL_SECONDS: z.coerce
    .number({ error: "RECORD_INTERVAL_SECONDS must be a number" })
    .int()
    .min(60, {
      error:
        "RECORD_INTERVAL_SECONDS must be at least 60 (FreeCryptoAPI free plan: 100k requests/month)",
    })
    .default(60),
  FREECRYPTOAPI_DAILY_BUDGET: z.coerce
    .number({ error: "FREECRYPTOAPI_DAILY_BUDGET must be a number" })
    .int()
    .min(1)
    .default(3200),
});

export interface Config {
  /** FreeCryptoAPI key for live coin prices (required). */
  freecryptoapiKey: string;
  /** Optional CoinGecko Demo key; without it the keyless public API is used (lower rate limits). */
  coingeckoApiKey: string | null;
  binanceBaseUrl: string;
  /** SQLite file holding recorded prices (":memory:" in tests). */
  dbPath: string;
  /** Whether the background price recorder runs in this server process. */
  recorderEnabled: boolean;
  recordIntervalMs: number;
  /** FreeCryptoAPI requests allowed per UTC day (default 3,200 ≈ 97k a month, under the free 100k). */
  freecryptoapiDailyBudget: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let cached: Config | null = null;

/**
 * Reads and validates server configuration. Throws a ConfigError with setup instructions
 * when a required variable is missing, instead of failing later with an opaque upstream error.
 */
export function getConfig(env: Record<string, string | undefined> = process.env): Config {
  if (cached && env === process.env) return cached;
  const parsed = EnvSchema.safeParse({
    FREECRYPTOAPI_KEY: env.FREECRYPTOAPI_KEY,
    COINGECKO_DEMO_API_KEY: env.COINGECKO_DEMO_API_KEY,
    BINANCE_BASE_URL: env.BINANCE_BASE_URL || undefined,
    AURATIO_DB_PATH: env.AURATIO_DB_PATH || undefined,
    RECORDER: env.RECORDER || undefined,
    RECORD_INTERVAL_SECONDS: env.RECORD_INTERVAL_SECONDS || undefined,
    FREECRYPTOAPI_DAILY_BUDGET: env.FREECRYPTOAPI_DAILY_BUDGET || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new ConfigError(
      `AuRatio configuration error:\n${problems}\n` +
        "Copy .env.example to .env.local and set FREECRYPTOAPI_KEY " +
        "(free key: https://freecryptoapi.com), then restart the server.",
    );
  }
  const config: Config = {
    freecryptoapiKey: parsed.data.FREECRYPTOAPI_KEY,
    coingeckoApiKey: parsed.data.COINGECKO_DEMO_API_KEY,
    binanceBaseUrl: parsed.data.BINANCE_BASE_URL,
    dbPath: parsed.data.AURATIO_DB_PATH,
    recorderEnabled: parsed.data.RECORDER === "on",
    recordIntervalMs: parsed.data.RECORD_INTERVAL_SECONDS * 1000,
    freecryptoapiDailyBudget: parsed.data.FREECRYPTOAPI_DAILY_BUDGET,
  };
  if (env === process.env) cached = config;
  return config;
}

export function resetConfigForTests(): void {
  cached = null;
}
