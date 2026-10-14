import { vi } from "vitest";
import { clearCacheForTests } from "../cache/cache";
import { resetConfigForTests } from "../config";
import { resetBreakersForTests, setSleepForTests } from "../http";
import { resetCoingeckoForTests } from "../providers/coingecko";
import { resetBudgetForTests } from "../providers/freecryptoapi";
import { resetRateLimitForTests } from "../rate-limit";
import { stopRecorderForTests } from "../recorder";
import { PriceStore, setStoreForTests } from "../store/price-store";
import { fakeUpstream, type FakeUpstreamOptions } from "./fake-upstream";

export const TEST_API_KEY = "test-key-SECRET-123";
export const TEST_FCA_KEY = "fca-key-SECRET-456";
/** Sunday 11 Oct 2026, 13:34 UTC: gold's last close is Friday's. */
export const NOW = Date.UTC(2026, 9, 11, 13, 34);

/** Installs a fake upstream as global fetch with clean caches, config, breakers and an empty in-memory price store. */
export function installFakeUpstream(options: Partial<FakeUpstreamOptions> = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(options.now ?? NOW);
  vi.stubEnv("FREECRYPTOAPI_KEY", TEST_FCA_KEY);
  vi.stubEnv("COINGECKO_DEMO_API_KEY", TEST_API_KEY);
  vi.stubEnv("BINANCE_BASE_URL", "");
  vi.stubEnv("AURATIO_DB_PATH", ":memory:");
  vi.stubEnv("RECORDER", "off");
  resetConfigForTests();
  setStoreForTests(new PriceStore(":memory:"));
  clearCacheForTests();
  resetBreakersForTests();
  resetCoingeckoForTests();
  resetBudgetForTests();
  resetRateLimitForTests();
  setSleepForTests(async () => undefined);
  const fake = fakeUpstream({ now: options.now ?? NOW, ...options });
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

export function uninstallFakeUpstream() {
  stopRecorderForTests();
  setStoreForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setSleepForTests(null);
  resetConfigForTests();
}
