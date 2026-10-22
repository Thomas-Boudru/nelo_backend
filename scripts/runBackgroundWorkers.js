require("dotenv").config();

const pool = require("../db/pool");

const { startBackgroundWorkers } = require("../services/backgroundWorkers");

const workers = startBackgroundWorkers();

let shutdownPromise = null;

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  console.info("[Worker process] stopping", { signal });

  const deadline = setTimeout(() => {
    console.error("[Worker process] shutdown deadline exceeded");
    process.exit(1);
  }, 25_000);

  deadline.unref();

  shutdownPromise = (async () => {
    try {
      await workers.stop();
      await pool.end();

      console.info("[Worker process] stopped");
    } catch {
      process.exitCode = 1;
      console.error("[Worker process] shutdown failed");
    } finally {
      clearTimeout(deadline);
    }
  })();

  return shutdownPromise;
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
