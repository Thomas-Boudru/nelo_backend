require("dotenv").config();

const pool = require("../db/pool");

const {
  runRevenueCatWorkerCycle,
} = require("../services/billing/revenuecat/revenuecatWorker");

let stopping = false;
let timer = null;
let running = false;

async function shutdown() {
  stopping = true;

  if (timer) {
    clearTimeout(timer);
  }

  if (!running) {
    await pool.end();
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function tick() {
  if (stopping) {
    return;
  }

  running = true;

  try {
    await runRevenueCatWorkerCycle();
  } catch (error) {
    const code =
      typeof error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(error.code)
        ? error.code
        : "REVENUECAT_WORKER_FAILED";

    console.error("[RevenueCat worker]", code);
  } finally {
    running = false;

    if (stopping) {
      await pool.end();
    } else {
      timer = setTimeout(tick, 30_000);
    }
  }
}

tick();
