const { getChildAgeAt } = require("./childAge.js");

const {
  SLEEP_PREDICTION_VERSION,
  SLEEP_PREDICTION_CONFIG,
  getAgeWakeWindow,
  getAgeSleepRhythm,
  BEDTIME_PREDICTION_CONFIG,
} = require("./sleepPredictionRules.js");

const { normalizeSleepHistory } = require("./normalizeSleepHistory.js");

const MINUTE = 60000;
const DAY = 86400000;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const median = (values) => {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

const weightedMedian = (samples) => {
  if (!samples.length) return null;

  const sorted = [...samples].sort((a, b) => a.value - b.value);

  const total = sorted.reduce((sum, s) => sum + s.weight, 0);

  let running = 0;

  for (const sample of sorted) {
    running += sample.weight;

    if (running >= total / 2) {
      return sample.value;
    }
  }

  return sorted.at(-1).value;
};

function localParts(ms, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const p = Object.fromEntries(
    parts
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );

  return {
    day: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    minute: p.hour * 60 + p.minute,
  };
}

function napPosition(sleeps, timestamp, timezone) {
  const day = localParts(timestamp, timezone).day;

  return (
    sleeps.filter(
      (s) =>
        s.sleepType === "nap" &&
        s.startedAtMs < timestamp &&
        localParts(s.startedAtMs, timezone).day === day,
    ).length + 1
  );
}

function circularMedian(minutes) {
  if (!minutes.length) return null;

  const angles = minutes.map((m) => (m * 2 * Math.PI) / 1440);

  const sin = angles.reduce((sum, a) => sum + Math.sin(a), 0);

  const cos = angles.reduce((sum, a) => sum + Math.cos(a), 0);

  const concentration = Math.hypot(sin, cos) / minutes.length;

  if (concentration < 0.6) return null;

  const angle = (Math.atan2(sin, cos) + 2 * Math.PI) % (2 * Math.PI);

  return {
    minute: (angle * 1440) / (2 * Math.PI),
    concentration,
  };
}

function bedtimePattern(nights, nowMs, timezone) {
  const recent = nights.filter((n) => nowMs - n.startedAtMs <= 14 * DAY);

  const distinctDays = new Set(
    recent.map((n) => localParts(n.startedAtMs, timezone).day),
  );

  if (recent.length < 4 || distinctDays.size < 4) {
    return null;
  }

  const result = circularMedian(
    recent.map((n) => localParts(n.startedAtMs, timezone).minute),
  );

  return result ? { ...result, count: recent.length } : null;
}

function getFallbackBedtimePattern(nights, nowMs, timezone) {
  const recent = nights
    .filter(
      (night) =>
        night.startedAtMs <= nowMs && nowMs - night.startedAtMs <= 7 * DAY,
    )
    .sort((a, b) => b.startedAtMs - a.startedAtMs);

  if (recent.length < BEDTIME_PREDICTION_CONFIG.minimumFallbackNights) {
    return null;
  }

  const result = circularMedian(
    recent.map((night) => localParts(night.startedAtMs, timezone).minute),
  );

  if (!result) {
    return null;
  }

  return {
    ...result,
    count: recent.length,
    personalized: false,
  };
}

function nextOccurrenceOfLocalMinute(nowMs, minute, timezone) {
  // Recherche l'heure locale sur les prochaines 36 heures.
  // Les changements d'heure sont gérés par Intl.
  const start = Math.floor(nowMs / MINUTE) * MINUTE;

  for (let offset = 0; offset <= 36 * 60; offset++) {
    const candidate = start + offset * MINUTE;

    if (localParts(candidate, timezone).minute === Math.round(minute) % 1440) {
      return candidate;
    }
  }

  return null;
}

function base(status, reason) {
  return {
    status,
    reason,
    algorithmVersion: SLEEP_PREDICTION_VERSION,
  };
}

function predictNextSleep({
  child,
  entries = [],
  now,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) {
  const nowMs = new Date(now).getTime();

  if (!Number.isFinite(nowMs)) {
    return base("unavailable", "invalid_reference_date");
  }

  if (!child || child.status === "expected") {
    return base("unavailable", "child_not_born");
  }

  try {
    localParts(nowMs, timezone);
  } catch {
    return base("unavailable", "invalid_timezone");
  }

  const age = getChildAgeAt({
    birthDate: child.birthDate,
    gestationalAgeWeeks: child.gestationalAgeWeeks,
    gestationalAgeDays: child.gestationalAgeDays,
    at: new Date(nowMs),
    timezone,
  });

  if (age.chronologicalAgeDays == null || age.chronologicalAgeDays < 0) {
    return base("unavailable", "invalid_child_age");
  }

  const effectiveAge = Math.max(
    0,
    age.correctedAgeDays ?? age.chronologicalAgeDays,
  );

  const reference = getAgeWakeWindow(effectiveAge);

  if (!reference) {
    return base("unavailable", "age_not_supported");
  }

  const history = normalizeSleepHistory({
    entries,
    now: new Date(nowMs),
    historyDays: SLEEP_PREDICTION_CONFIG.historyDays,
  });

  // Sommeil actuellement en cours.
  if (history.hasActiveSleep) {
    const active = history.activeSleeps.at(-1);

    return {
      status: "sleeping",
      type: active.sleepType === "night" ? "bedtime" : "nap",
      startedAt: new Date(active.startedAtMs).toISOString(),
      elapsedMinutes: Math.floor((nowMs - active.startedAtMs) / MINUTE),
      algorithmVersion: SLEEP_PREDICTION_VERSION,
    };
  }

  const last = history.lastCompletedSleep;

  if (!last) {
    return base("learning", "no_sleep_history");
  }

  const awake = (nowMs - last.endedAtMs) / MINUTE;

  if (!Number.isFinite(awake) || awake < 0) {
    return base("unavailable", "invalid_last_wake");
  }

  if (awake > 16 * 60) {
    return base("learning", "stale_sleep_history");
  }

  const position = napPosition(history.sleeps, nowMs, timezone);

  // Historique personnalisé des périodes d'éveil.
  const samples = history.learningWakePeriods
    .filter((p) => p.nextSleepType === "nap")
    .map((p) => {
      const same =
        napPosition(history.sleeps, p.endedAtMs, timezone) === position;

      return {
        value: p.durationMinutes,
        same,
        weight:
          Math.exp(-Math.max(0, (nowMs - p.endedAtMs) / DAY) / 10) *
          (same ? 1 : 0.35),
      };
    })
    .filter((s) => Number.isFinite(s.value) && s.value > 0 && s.weight > 0);

  const sameSamples = samples.filter((s) => s.same);

  const personalized =
    samples.length >= SLEEP_PREDICTION_CONFIG.minimumPersonalizedSamples &&
    sameSamples.length >= 2;

  const learned = personalized
    ? clamp(
        weightedMedian(samples),
        reference.minimumMinutes * 0.75,
        reference.maximumMinutes * 1.25,
      )
    : reference.midpointMinutes;

  const blend = personalized ? clamp(samples.length / 12, 0.3, 0.85) : 0;

  let target = Math.round(
    reference.midpointMinutes * (1 - blend) + learned * blend,
  );

  let advice = "follow_sleep_signs";

  // Ajustement après une sieste courte.
  if (
    last.sleepType === "nap" &&
    last.durationMinutes < SLEEP_PREDICTION_CONFIG.shortNapThresholdMinutes
  ) {
    target -= SLEEP_PREDICTION_CONFIG.shortNapAdjustmentMinutes;

    advice = "short_last_nap";
  }

  target = clamp(target, 30, 360);

  const napAt = last.endedAtMs + target * MINUTE;

  const rhythm = getAgeSleepRhythm(effectiveAge);

  const personalizedBedtimePattern = bedtimePattern(
    history.learningNights,
    nowMs,
    timezone,
  );

  const fallbackBedtimePattern =
    !personalizedBedtimePattern && rhythm?.bedtimeFallbackEnabled
      ? getFallbackBedtimePattern(history.learningNights, nowMs, timezone)
      : null;

  const pattern = personalizedBedtimePattern ?? fallbackBedtimePattern;

  let type = "nap";
  let predictedAt = napAt;

  if (pattern && rhythm?.bedtimeFallbackEnabled) {
    const nextBed = nextOccurrenceOfLocalMinute(
      nowMs,
      pattern.minute,
      timezone,
    );

    const minimumBedtime =
      last.endedAtMs +
      BEDTIME_PREDICTION_CONFIG.minimumWakeBeforeBedtimeMinutes * MINUTE;

    const proximity =
      BEDTIME_PREDICTION_CONFIG.bedtimeProximityMinutes * MINUTE;

    const bedtimeIsPlausible =
      nextBed !== null &&
      nextBed >= minimumBedtime &&
      nextBed - nowMs <= 16 * 60 * MINUTE &&
      Math.abs(napAt - nextBed) <= proximity;

    if (bedtimeIsPlausible) {
      type = "bedtime";
      predictedAt = nextBed;
      advice = "start_bedtime_routine";
    }
  }

  const variability = personalized
    ? median(samples.map((s) => Math.abs(s.value - learned)))
    : null;

  const halfWidth = clamp(
    variability == null ? 15 : Math.round(Math.max(15, variability * 1.5)),
    15,
    45,
  );

  const start = predictedAt - halfWidth * MINUTE;

  const end = predictedAt + halfWidth * MINUTE;

  // Ne pas afficher une prédiction trop ancienne.
  if (nowMs > end + 60 * MINUTE) {
    return {
      status: "overdue",
      reason: "prediction_expired",
      type,
      predictedAt: new Date(predictedAt).toISOString(),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      algorithmVersion: SLEEP_PREDICTION_VERSION,
    };
  }

  const confidence = !personalized
    ? "low"
    : samples.length >= SLEEP_PREDICTION_CONFIG.minimumHighConfidenceSamples &&
        variability <= 20 &&
        awake <= 240
      ? "high"
      : "good";

  const finalConfidence =
    type === "bedtime" && !personalizedBedtimePattern ? "low" : confidence;

  // Raisons structurées pour i18next.
  const reasons = [
    {
      type: "awake_duration",
      minutes: Math.floor(awake),
    },
  ];

  if (last.sleepType === "nap") {
    reasons.push({
      type: "last_nap_duration",
      minutes: Math.round(last.durationMinutes),
    });
  }

  if (type === "bedtime") {
    reasons.push({
      type: "usual_bedtime",
      timeMinutes: Math.round(pattern.minute),
    });
  } else {
    reasons.push({
      type: "usual_wake_window",
      minimumMinutes: personalized
        ? Math.max(0, target - 15)
        : reference.minimumMinutes,
      maximumMinutes: personalized ? target + 15 : reference.maximumMinutes,
    });
  }

  const routineStart =
    start - SLEEP_PREDICTION_CONFIG.routineLeadMinutes * MINUTE;

  const notificationAt =
    start - SLEEP_PREDICTION_CONFIG.notificationLeadMinutes * MINUTE;

  return {
    status: "prediction",
    type,

    predictedAt: new Date(predictedAt).toISOString(),

    windowStart: new Date(start).toISOString(),

    windowEnd: new Date(end).toISOString(),

    routineStart: new Date(routineStart).toISOString(),

    minutesUntil: Math.max(0, Math.ceil((start - nowMs) / MINUTE)),

    confidence: finalConfidence,
    personalized,
    sampleCount: samples.length,
    targetWakeMinutes: target,
    napPosition: position,

    reasons,
    advice,

    age: {
      chronologicalAgeDays: age.chronologicalAgeDays,
      correctedAgeDays: age.correctedAgeDays,
      correctionApplied: age.correctionApplied,
    },

    notification: {
      eligible: confidence !== "low" && notificationAt > nowMs,

      scheduledAt: new Date(notificationAt).toISOString(),
    },

    computedAt: new Date(nowMs).toISOString(),

    algorithmVersion: SLEEP_PREDICTION_VERSION,
  };
}

module.exports = {
  predictNextSleep,
};
