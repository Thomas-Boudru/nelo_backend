const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const VALID_SLEEP_TYPES = new Set(["nap", "night"]);

// Limites techniques de validation.
// Elles ne constituent pas des normes médicales.
const MIN_SLEEP_MINUTES = 1;
const MAX_SLEEP_MINUTES = 24 * 60;
const MAX_WAKE_MINUTES = 16 * 60;

// Seuils provisoires de qualité statistique.
// Une entrée atypique reste dans l'historique.
const MAX_LEARNING_NAP_MINUTES = 240;
const MAX_LEARNING_NIGHT_MINUTES = 16 * 60;
const MIN_LEARNING_WAKE_MINUTES = 20;

function parseTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeEntry(entry, nowMs) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (entry.type !== "sleep") {
    return null;
  }

  if (!VALID_SLEEP_TYPES.has(entry.sleepType)) {
    return null;
  }

  if (entry.deletedAt != null || entry.syncStatus === "conflict") {
    return null;
  }

  const startedAtMs = parseTimestamp(entry.startedAt);

  if (startedAtMs === null || startedAtMs > nowMs) {
    return null;
  }

  const isActive = entry.endedAt == null;

  const endedAtMs = isActive ? null : parseTimestamp(entry.endedAt);

  if (!isActive) {
    if (endedAtMs === null || endedAtMs > nowMs || endedAtMs <= startedAtMs) {
      return null;
    }
  }

  const durationMinutes = isActive
    ? null
    : (endedAtMs - startedAtMs) / MINUTE_MS;

  if (
    durationMinutes !== null &&
    (durationMinutes < MIN_SLEEP_MINUTES || durationMinutes > MAX_SLEEP_MINUTES)
  ) {
    return null;
  }

  const isAtypicalDuration =
    durationMinutes !== null &&
    ((entry.sleepType === "nap" &&
      durationMinutes > MAX_LEARNING_NAP_MINUTES) ||
      (entry.sleepType === "night" &&
        durationMinutes > MAX_LEARNING_NIGHT_MINUTES));

  return {
    id: entry.id ?? null,
    sleepType: entry.sleepType,

    startedAtMs,
    endedAtMs,
    durationMinutes,

    isActive,
    isAtypicalDuration,

    // Les durées atypiques ne servent pas
    // à personnaliser les habitudes.
    eligibleForLearning: !isActive && !isAtypicalDuration,

    source: entry.source ?? null,
    syncStatus: entry.syncStatus ?? "synced",
  };
}

function removeDuplicates(entries) {
  const seen = new Set();

  return entries.filter((entry) => {
    if (!entry.id) {
      return true;
    }

    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);

    return true;
  });
}

function removeOverlaps(entries) {
  const accepted = [];
  const rejected = [];

  for (const entry of entries) {
    const previous = accepted.at(-1);

    if (
      previous &&
      entry.startedAtMs < (previous.endedAtMs ?? Number.POSITIVE_INFINITY)
    ) {
      rejected.push(entry);
      continue;
    }

    accepted.push(entry);
  }

  return {
    accepted,
    rejected,
  };
}

function buildWakePeriods(sleeps) {
  const periods = [];

  for (let index = 1; index < sleeps.length; index += 1) {
    const previous = sleeps[index - 1];
    const current = sleeps[index];

    if (previous.isActive || current.isActive) {
      continue;
    }

    const startedAtMs = previous.endedAtMs;
    const endedAtMs = current.startedAtMs;

    if (startedAtMs == null || endedAtMs == null || endedAtMs <= startedAtMs) {
      continue;
    }

    const durationMinutes = (endedAtMs - startedAtMs) / MINUTE_MS;

    if (durationMinutes <= 0 || durationMinutes > MAX_WAKE_MINUTES) {
      continue;
    }

    const isAtypicalWakeDuration = durationMinutes < MIN_LEARNING_WAKE_MINUTES;

    const eligibleForLearning =
      previous.eligibleForLearning &&
      current.eligibleForLearning &&
      !isAtypicalWakeDuration;

    periods.push({
      startedAtMs,
      endedAtMs,
      durationMinutes,

      previousSleepId: previous.id,
      nextSleepId: current.id,

      previousSleepType: previous.sleepType,
      nextSleepType: current.sleepType,

      previousSleepDurationMinutes: previous.durationMinutes,

      previousSleepEligibleForLearning: previous.eligibleForLearning,

      nextSleepEligibleForLearning: current.eligibleForLearning,

      isAtypicalWakeDuration,
      eligibleForLearning,
    });
  }

  return periods;
}

function normalizeSleepHistory({ entries = [], now, historyDays = 21 }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (!Number.isFinite(nowMs)) {
    throw new Error("Invalid sleep prediction reference date.");
  }

  if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 90) {
    throw new Error("Invalid sleep history period.");
  }

  const historyStartMs = nowMs - historyDays * DAY_MS;

  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeEntry(entry, nowMs))
    .filter(Boolean)
    .filter(
      (entry) =>
        entry.startedAtMs >= historyStartMs ||
        (entry.endedAtMs !== null && entry.endedAtMs >= historyStartMs) ||
        entry.isActive,
    )
    .sort(
      (a, b) =>
        a.startedAtMs - b.startedAtMs ||
        String(a.id).localeCompare(String(b.id)),
    );

  const unique = removeDuplicates(normalized);

  const { accepted, rejected } = removeOverlaps(unique);

  const activeSleeps = accepted.filter((entry) => entry.isActive);

  const completedSleeps = accepted.filter((entry) => !entry.isActive);

  const naps = completedSleeps.filter((entry) => entry.sleepType === "nap");

  const nights = completedSleeps.filter((entry) => entry.sleepType === "night");

  const learningNaps = naps.filter((entry) => entry.eligibleForLearning);

  const learningNights = nights.filter((entry) => entry.eligibleForLearning);

  const wakePeriods = buildWakePeriods(accepted);

  const learningWakePeriods = wakePeriods.filter(
    (period) => period.eligibleForLearning,
  );

  const lastSleep = accepted.at(-1) ?? null;

  const lastCompletedSleep = completedSleeps.at(-1) ?? null;

  return {
    nowMs,
    historyStartMs,

    sleeps: accepted,
    completedSleeps,
    activeSleeps,

    naps,
    nights,
    wakePeriods,

    // Sous-ensembles destinés à
    // l'apprentissage des habitudes.
    learningNaps,
    learningNights,
    learningWakePeriods,

    lastSleep,
    lastCompletedSleep,

    hasActiveSleep: activeSleeps.length > 0,

    statistics: {
      totalSleeps: accepted.length,
      completedSleeps: completedSleeps.length,

      napCount: naps.length,
      nightCount: nights.length,
      wakePeriodCount: wakePeriods.length,

      learningNapCount: learningNaps.length,

      learningNightCount: learningNights.length,

      learningWakePeriodCount: learningWakePeriods.length,

      atypicalSleepCount: completedSleeps.filter(
        (entry) => entry.isAtypicalDuration,
      ).length,

      rejectedOverlapCount: rejected.length,
    },
  };
}

module.exports = {
  normalizeSleepHistory,
};
