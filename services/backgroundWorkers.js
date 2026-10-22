const {
  runRevenueCatWorkerCycle,
} = require("./billing/revenuecat/revenuecatWorker");

const { runNeloAIWorkerCycle } = require("./nelo/neloAIWorker");

const {
  runDailyReportSchedulerCycle,
} = require("./dailyReports/dailyReportScheduler");

const {
  runDailyReportWorkerCycle,
} = require("./dailyReports/dailyReportWorker");

let controller = null;

function safeCode(error) {
  return typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : "BACKGROUND_WORKER_FAILED";
}

function startBackgroundWorkers() {
  if (controller) return controller;

  let stopping = false;
  let stopPromise = null;

  const timers = new Map();
  const activeTasks = new Set();

  function startLoop(name, cycle, delayMs) {
    async function tick() {
      timers.delete(name);

      if (stopping) return;

      const task = Promise.resolve().then(cycle);
      activeTasks.add(task);

      try {
        await task;
      } catch (error) {
        console.error(`[${name}]`, {
          code: safeCode(error),
        });
      } finally {
        activeTasks.delete(task);

        if (!stopping) {
          timers.set(name, setTimeout(tick, delayMs));
        }
      }
    }

    void tick();
  }

  function stop() {
    if (stopPromise) return stopPromise;

    stopping = true;

    for (const timer of timers.values()) {
      clearTimeout(timer);
    }

    timers.clear();

    stopPromise = Promise.allSettled([...activeTasks]).then(() => {
      console.info("[Background workers] stopped");
    });

    return stopPromise;
  }

  controller = { stop };

  startLoop("RevenueCat worker", runRevenueCatWorkerCycle, 30_000);

  startLoop("Nelo AI worker", runNeloAIWorkerCycle, 2_000);

  // Les rapports restent désactivables indépendamment du chat.
  if (process.env.DAILY_REPORTS_ENABLED?.trim() === "true") {
    startLoop(
      "Daily report scheduler",
      runDailyReportSchedulerCycle,
      15 * 60_000,
    );

    startLoop("Daily report worker", runDailyReportWorkerCycle, 5_000);
  }

  console.info("[Background workers] started", {
    dailyReportsEnabled: process.env.DAILY_REPORTS_ENABLED?.trim() === "true",
  });

  return controller;
}

module.exports = {
  startBackgroundWorkers,
};
