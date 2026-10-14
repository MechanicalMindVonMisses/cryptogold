// Runs once when the Next.js server starts: validates configuration (a missing key is reported
// immediately and readably) and starts the background price recorder.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` may load this file while prerendering; never record during a build.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getConfig, ConfigError } = await import("./server/config");
  let recorderEnabled: boolean;
  try {
    recorderEnabled = getConfig().recorderEnabled;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n`);
      return;
    }
    throw err;
  }
  if (!recorderEnabled) return;

  const { startRecorder } = await import("./server/recorder");
  try {
    startRecorder();
  } catch (err) {
    // The dashboard still works without recording; the history view will say nothing is recorded.
    console.error(
      "[auratio] price recorder could not start:",
      err instanceof Error ? err.message : err,
    );
  }
}
