require("dotenv").config();

const pool = require("../db/pool");

const {
  processAppleEvents,
} = require("../services/billing/appleEventProcessor");

async function main() {
  try {
    const summary = await processAppleEvents({ limit: 20 });

    console.log(JSON.stringify(summary, null, 2));

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Apple event processor stopped:", {
      code: error.code || "APPLE_EVENT_PROCESSOR_FAILED",
      message: error.message,
    });

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
