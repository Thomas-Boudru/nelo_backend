require("dotenv").config();

const pool = require("../db/pool");

const {
  runRevenueCatWorkerCycle,
} = require("../services/billing/revenuecat/revenuecatWorker");

const { runNeloAIWorkerCycle } = require("../services/nelo/neloAIWorker");

let stopping = false;
let shutdownStarted = false;

const timers = new Map();
const activeTasks = new Set();

function safeCode(error) {
  return typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : "BACKGROUND_WORKER_FAILED";
}

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

        ...(error?.code === "42P08"
          ? {
              message: error.message,
              detail: error.detail,
              position: error.position,
              stack: error.stack,
            }
          : {}),
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

async function shutdown(signal) {
  if (shutdownStarted) return;

  shutdownStarted = true;
  stopping = true;

  console.info("[Background workers] stopping", signal);

  for (const timer of timers.values()) {
    clearTimeout(timer);
  }

  timers.clear();

  // Les traitements déjà commencés peuvent terminer.
  // Si l'hébergeur coupe avant, la récupération des tâches prendra
  // le relais au prochain démarrage.
  await Promise.allSettled([...activeTasks]);

  await pool.end();

  console.info("[Background workers] stopped");
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => {
    process.exitCode = 1;
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => {
    process.exitCode = 1;
  });
});

console.info("[Background workers] starting");

console.info(
  "RevenueCat diagnostics enabled:",
  process.env.REVENUECAT_DIAGNOSTIC_LOGS?.trim() === "true",
);

startLoop("RevenueCat worker", runRevenueCatWorkerCycle, 30_000);

// Une seule tâche IA à la fois dans ce processus.
// Nouvelle recherche deux secondes après la fin du cycle.
startLoop("Nelo AI worker", runNeloAIWorkerCycle, 2_000);
