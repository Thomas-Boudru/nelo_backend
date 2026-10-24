const DAY_MS = 24 * 60 * 60 * 1000;

const FULL_TERM_GESTATION_DAYS = 280;
const PREMATURITY_THRESHOLD_DAYS = 37 * 7;
const CORRECTED_AGE_LIMIT_DAYS = 730;

function parseCalendarDate(value) {
  if (typeof value !== "string") {
    return null;
  }

  // Accepte :
  // "2026-05-30"
  // "2026-05-30T00:00:00.000Z"
  // "2026-05-30T00:00:00+02:00"
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const timestamp = Date.UTC(year, month - 1, day);

  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function getCalendarDayTimestamp(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  );

  return Date.UTC(values.year, values.month - 1, values.day);
}

function getChildAgeAt({
  birthDate,
  gestationalAgeWeeks = null,
  gestationalAgeDays = null,
  at,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) {
  const birthTimestamp = parseCalendarDate(birthDate);
  const referenceDate = new Date(at);

  if (birthTimestamp === null || !Number.isFinite(referenceDate.getTime())) {
    return {
      availability: "missing_data",
      chronologicalAgeDays: null,
      correctedAgeDays: null,
      correctionDays: null,
      correctionApplied: false,
    };
  }

  let referenceDay;

  try {
    referenceDay = getCalendarDayTimestamp(referenceDate, timezone);
  } catch {
    return {
      availability: "invalid_timezone",
      chronologicalAgeDays: null,
      correctedAgeDays: null,
      correctionDays: null,
      correctionApplied: false,
    };
  }

  const chronologicalAgeDays = Math.floor(
    (referenceDay - birthTimestamp) / DAY_MS,
  );

  if (chronologicalAgeDays < 0) {
    return {
      availability: "not_born",
      chronologicalAgeDays,
      correctedAgeDays: null,
      correctionDays: null,
      correctionApplied: false,
    };
  }

  const validWeeks =
    Number.isInteger(gestationalAgeWeeks) &&
    gestationalAgeWeeks >= 20 &&
    gestationalAgeWeeks <= 45;

  const validDays =
    gestationalAgeDays == null ||
    (Number.isInteger(gestationalAgeDays) &&
      gestationalAgeDays >= 0 &&
      gestationalAgeDays <= 6);

  if (!validWeeks || !validDays) {
    return {
      availability: "chronological_only",
      chronologicalAgeDays,
      correctedAgeDays: chronologicalAgeDays,
      correctionDays: 0,
      correctionApplied: false,
    };
  }

  const gestationalDays = gestationalAgeWeeks * 7 + (gestationalAgeDays ?? 0);

  const isPremature = gestationalDays < PREMATURITY_THRESHOLD_DAYS;

  const correctionDays = isPremature
    ? FULL_TERM_GESTATION_DAYS - gestationalDays
    : 0;

  const correctionApplied =
    isPremature && chronologicalAgeDays < CORRECTED_AGE_LIMIT_DAYS;

  const correctedAgeDays = correctionApplied
    ? chronologicalAgeDays - correctionDays
    : chronologicalAgeDays;

  return {
    availability: "available",
    chronologicalAgeDays,
    correctedAgeDays,
    correctionDays,
    correctionApplied,
  };
}

module.exports = {
  getChildAgeAt,
};
