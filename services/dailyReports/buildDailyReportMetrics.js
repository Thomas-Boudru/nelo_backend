const MIN_REFERENCE_DAYS = 4;

function timestamp(value) {
  if (value == null) return NaN;
  return Date.parse(value);
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function createMetric() {
  return {
    count: 0,
    validCount: 0,
    invalidCount: 0,
    recordedTotal: 0,
    total: null,
    status: "no_data",
  };
}

function addMetric(metric, value) {
  metric.count += 1;

  if (!nonNegative(value)) {
    metric.invalidCount += 1;
    return;
  }

  metric.validCount += 1;
  metric.recordedTotal += value;
}

function finishMetric(metric) {
  metric.recordedTotal = round(metric.recordedTotal);

  metric.status =
    metric.count === 0
      ? "no_data"
      : metric.invalidCount === 0
        ? "valid"
        : metric.validCount > 0
          ? "partial"
          : "invalid";

  metric.total = metric.status === "valid" ? metric.recordedTotal : null;

  return metric;
}

function unionSeconds(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);

  let total = 0;
  let current = null;
  let overlaps = false;

  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
      continue;
    }

    if (interval.start < current.end) {
      overlaps = true;
    }

    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      total += current.end - current.start;
      current = { ...interval };
    }
  }

  if (current) {
    total += current.end - current.start;
  }

  return {
    seconds: total / 1000,
    overlaps,
  };
}

function buildDay(day, entries, dataCutoffMs) {
  const start = timestamp(day.startsAt);
  const end = timestamp(day.endsAt);

  const bottles = createMetric();
  const breastfeeding = createMetric();
  const pumping = createMetric();
  const solids = createMetric();
  const diapers = createMetric();

  const diaperContents = {
    dry: 0,
    withUrine: 0,
    withStool: 0,
  };

  const intervals = [];
  let sleepCount = 0;
  let uncertainSleepCount = 0;
  let invalidSleepCount = 0;

  // Événements complémentaires : données descriptives uniquement.
  const events = {
    temperature: [],
    symptoms: [],
    medication: [],
    vaccine: [],
    growth: [],
    teething: [],
  };

  for (const entry of entries) {
    const startedAt = timestamp(entry.startedAt);

    if (entry.type === "sleep") {
      if (!Number.isFinite(startedAt)) {
        // Impossible de garantir que ce sommeil n'affecte pas
        // cette journée.
        uncertainSleepCount += 1;
        continue;
      }

      if (startedAt >= end) continue;

      if (entry.endedAt == null) {
        // Ne pas considérer un minuteur oublié comme une durée
        // de sommeil confirmée, même pour une journée passée.
        uncertainSleepCount += 1;
        continue;
      }

      const endedAt = timestamp(entry.endedAt);

      if (
        !Number.isFinite(endedAt) ||
        endedAt < startedAt ||
        endedAt > dataCutoffMs
      ) {
        invalidSleepCount += 1;
        continue;
      }

      if (endedAt <= start) continue;

      sleepCount += 1;

      const interval = {
        start: Math.max(start, startedAt),
        end: Math.min(end, endedAt),
        type: entry.sleepType,
      };

      if (interval.end > interval.start) {
        intervals.push(interval);
      }

      continue;
    }

    const belongsToDay =
      entry.type === "growth"
        ? entry.measurementDate === day.dateKey
        : entry.type === "teething"
          ? entry.eruptionDate === day.dateKey
          : Number.isFinite(startedAt) && startedAt >= start && startedAt < end;

    if (!belongsToDay) continue;

    switch (entry.type) {
      case "bottle":
        addMetric(bottles, positive(entry.amountMl) ? entry.amountMl : NaN);
        break;

      case "breastfeeding": {
        const left = entry.leftDurationSeconds;
        const right = entry.rightDurationSeconds;

        const valid =
          nonNegative(left) && nonNegative(right) && left + right > 0;

        addMetric(breastfeeding, valid ? left + right : NaN);
        break;
      }

      case "pumping": {
        const left = entry.leftAmountMl;
        const right = entry.rightAmountMl;

        const valid =
          nonNegative(left) && nonNegative(right) && left + right > 0;

        addMetric(pumping, valid ? left + right : NaN);
        break;
      }

      case "solids":
        // Compte les repas, pas les aliments ou les calories.
        addMetric(solids, 1);
        break;

      case "diaper": {
        const content = entry.content;

        if (!["dry", "wet", "dirty", "wetAndDirty"].includes(content)) {
          addMetric(diapers, NaN);
          break;
        }

        addMetric(diapers, 1);

        if (content === "dry") diaperContents.dry += 1;

        if (["wet", "wetAndDirty"].includes(content)) {
          diaperContents.withUrine += 1;
        }

        if (["dirty", "wetAndDirty"].includes(content)) {
          diaperContents.withStool += 1;
        }

        break;
      }

      case "temperature":
        events.temperature.push({
          at: entry.startedAt,
          celsius: entry.temperatureCelsius,
          site: entry.measurementSite,
        });
        break;

      case "symptoms":
        events.symptoms.push({
          at: entry.startedAt,
          codes: entry.symptoms ?? [],
        });
        break;

      case "medication":
        events.medication.push({
          at: entry.startedAt,
          name: entry.medicationName,
          amount: entry.amount,
          unit: entry.unit,
        });
        break;

      case "vaccine":
        events.vaccine.push({
          at: entry.startedAt,
          name: entry.vaccineName,
          dose: entry.dose,
        });
        break;

      case "growth":
        events.growth.push({
          date: entry.measurementDate,
          weightKg: entry.weightKg,
          heightCm: entry.heightCm,
          headCircumferenceCm: entry.headCircumferenceCm,
        });
        break;

      case "teething":
        events.teething.push({
          date: entry.eruptionDate,
          toothCodes: entry.toothCodes ?? [],
        });
        break;

      default:
        break;
    }
  }

  const sleepUnion = unionSeconds(intervals);
  const napUnion = unionSeconds(
    intervals.filter((item) => item.type === "nap"),
  );
  const nightUnion = unionSeconds(
    intervals.filter((item) => item.type === "night"),
  );

  const hasSleepIssue =
    uncertainSleepCount > 0 || invalidSleepCount > 0 || sleepUnion.overlaps;

  const sleepStatus = hasSleepIssue
    ? "partial"
    : intervals.length > 0
      ? "valid"
      : "no_data";

  const methods = [];

  if (bottles.count > 0) methods.push("bottle");
  if (breastfeeding.count > 0) methods.push("breastfeeding");

  return {
    dateKey: day.dateKey,
    durationSeconds: (end - start) / 1000,

    feedingMethods: methods,

    bottles: finishMetric(bottles),
    breastfeeding: finishMetric(breastfeeding),
    pumping: finishMetric(pumping),
    solids: finishMetric(solids),

    diapers: {
      ...finishMetric(diapers),
      contents: diaperContents,
    },

    sleep: {
      status: sleepStatus,
      count: sleepCount,
      total: sleepStatus === "valid" ? sleepUnion.seconds : null,
      recordedClosedSeconds: sleepUnion.seconds,
      napSeconds: napUnion.seconds,
      nightSeconds: nightUnion.seconds,
      overlaps: sleepUnion.overlaps,
      uncertainCount: uncertainSleepCount,
      invalidCount: invalidSleepCount,
    },

    events,
  };
}

function compareMetric(days, metricName) {
  const current = days[days.length - 1];
  const previousDays = days.slice(0, -1);
  const excludedDays = [];

  function unavailable(reason) {
    return {
      available: false,
      reason,
      yesterday: null,
      historical: null,
      excludedDays,
    };
  }

  if (current[metricName].status !== "valid") {
    return unavailable("current_metric_unavailable");
  }

  if (metricName === "sleep" && current.durationSeconds !== 86400) {
    return unavailable("non_24_hour_day");
  }

  // Une référence de volume au biberon ne doit pas masquer
  // un changement entre allaitement et biberon.
  function exclusionReason(day) {
    if (day[metricName].status !== "valid") {
      return "metric_unavailable";
    }

    if (metricName === "sleep" && day.durationSeconds !== 86400) {
      return "non_24_hour_day";
    }

    if (
      ["bottles", "breastfeeding"].includes(metricName) &&
      day.feedingMethods.join("|") !== current.feedingMethods.join("|")
    ) {
      return "feeding_methods_changed";
    }

    return null;
  }

  const usableDays = previousDays.filter((day) => {
    const reason = exclusionReason(day);

    if (reason) {
      excludedDays.push({ dateKey: day.dateKey, reason });
      return false;
    }

    return true;
  });

  const yesterdayDay = previousDays[previousDays.length - 1];
  const yesterdayUsable = usableDays.includes(yesterdayDay);

  function difference(reference) {
    const delta = current[metricName].total - reference;

    return {
      current: current[metricName].total,
      reference,
      delta: round(delta),
      percent: reference > 0 ? round((delta / reference) * 100) : null,
    };
  }

  const yesterday = yesterdayUsable
    ? {
        dateKey: yesterdayDay.dateKey,
        ...difference(yesterdayDay[metricName].total),
      }
    : null;

  const historical =
    usableDays.length >= MIN_REFERENCE_DAYS
      ? {
          method: "median",
          dayCount: usableDays.length,
          dates: usableDays.map((day) => day.dateKey),
          ...difference(median(usableDays.map((day) => day[metricName].total))),
        }
      : null;

  return {
    available: Boolean(yesterday || historical),
    reason: yesterday || historical ? null : "insufficient_comparable_days",
    yesterday,
    historical,
    excludedDays,
  };
}

function buildDailyReportMetrics(data) {
  if (
    !data ||
    !Array.isArray(data.days) ||
    data.days.length !== 8 ||
    !Array.isArray(data.entries)
  ) {
    throw new Error("Invalid daily report data.");
  }

  const cutoff = timestamp(data.dataCutoffAt);

  if (!Number.isFinite(cutoff)) {
    throw new Error("Invalid daily report cutoff.");
  }

  for (let index = 0; index < data.days.length; index += 1) {
    const day = data.days[index];
    const start = timestamp(day.startsAt);
    const end = timestamp(day.endsAt);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end ||
      end > cutoff ||
      (index > 0 && data.days[index - 1].endsAt !== day.startsAt)
    ) {
      throw new Error("Invalid daily report day boundaries.");
    }
  }

  if (data.days[7].dateKey !== data.report.dateKey) {
    throw new Error("Daily report date mismatch.");
  }

  const unique = new Map();
  let unassignedEntryCount = 0;

  for (const entry of data.entries) {
    if (!entry || entry.deletedAt) continue;

    if (!entry.id || entry.childId !== data.report.childId) {
      throw new Error("Daily report entry identity mismatch.");
    }

    if (unique.has(entry.id)) {
      throw new Error("Duplicate daily report entry.");
    }

    unique.set(entry.id, entry);

    if (
      !["growth", "teething"].includes(entry.type) &&
      !Number.isFinite(timestamp(entry.startedAt))
    ) {
      unassignedEntryCount += 1;
    }
  }

  const entries = [...unique.values()];
  const days = data.days.map((day) => buildDay(day, entries, cutoff));

  const metricNames = [
    "sleep",
    "bottles",
    "breastfeeding",
    "pumping",
    "diapers",
    "solids",
  ];

  const comparisons = Object.fromEntries(
    metricNames.map((name) => [name, compareMetric(days, name)]),
  );

  // Une entrée impossible à dater peut modifier les totaux.
  // Ne pas afficher une comparaison apparemment fiable.
  if (unassignedEntryCount > 0) {
    for (const name of metricNames) {
      comparisons[name] = {
        available: false,
        reason: "unassigned_entries",
        yesterday: null,
        historical: null,
        excludedDays: [],
      };
    }
  }

  const current = days[days.length - 1];

  const hasUsableData =
    metricNames.some((name) => current[name].status === "valid") ||
    Object.values(current.events).some((items) => items.length > 0);

  return {
    version: "daily-report-metrics-v1",
    dateKey: data.report.dateKey,
    timeZone: data.report.timeZone,
    dataCutoffAt: data.dataCutoffAt,

    units: {
      sleep: "seconds",
      bottles: "ml",
      breastfeeding: "seconds",
      pumping: "ml",
      diapers: "count",
      solids: "count",
    },

    hasUsableData,
    quality: {
      unassignedEntryCount,
      // Des saisies valides ne prouvent pas une saisie exhaustive.
      recordingCompleteness: "unknown",
    },

    current,
    previousDays: days.slice(0, -1),
    comparisons,
  };
}

module.exports = {
  buildDailyReportMetrics,
};
