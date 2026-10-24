const pool = require("../../db/pool");

const VALID_STATUSES = new Set([
  "prediction",
  "learning",
  "sleeping",
  "unavailable",
]);

const VALID_SLEEP_TYPES = new Set(["nap", "bedtime"]);

const VALID_CONFIDENCE = new Set(["low", "good", "high"]);

function validateDate(value, field, required = false) {
  if (value == null) {
    if (required) {
      throw new Error(`Missing ${field}.`);
    }

    return null;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ${field}.`);
  }

  return date.toISOString();
}

function validatePrediction(prediction) {
  if (
    !prediction ||
    typeof prediction !== "object" ||
    Array.isArray(prediction)
  ) {
    throw new Error("Invalid sleep prediction.");
  }

  if (!VALID_STATUSES.has(prediction.status)) {
    throw new Error("Invalid sleep prediction status.");
  }

  const isPrediction = prediction.status === "prediction";

  const sleepType = prediction.type ?? null;

  if (sleepType !== null && !VALID_SLEEP_TYPES.has(sleepType)) {
    throw new Error("Invalid sleep prediction type.");
  }

  const confidence = prediction.confidence ?? null;

  if (confidence !== null && !VALID_CONFIDENCE.has(confidence)) {
    throw new Error("Invalid sleep prediction confidence.");
  }

  const predictedAt = validateDate(
    prediction.predictedAt,
    "predicted sleep time",
    isPrediction,
  );

  const windowStart = validateDate(
    prediction.windowStart,
    "sleep window start",
    isPrediction,
  );

  const windowEnd = validateDate(
    prediction.windowEnd,
    "sleep window end",
    isPrediction,
  );

  const routineStart = validateDate(
    prediction.routineStart,
    "sleep routine start",
  );

  if (isPrediction) {
    if (!sleepType) {
      throw new Error("Missing sleep prediction type.");
    }

    if (
      Date.parse(windowStart) > Date.parse(predictedAt) ||
      Date.parse(predictedAt) > Date.parse(windowEnd)
    ) {
      throw new Error("Invalid sleep prediction window.");
    }
  }

  const reasons = Array.isArray(prediction.reasons) ? prediction.reasons : [];

  const adviceCodes = prediction.advice
    ? [
        {
          code: prediction.advice,
          params: {},
        },
      ]
    : [];

  return {
    status: prediction.status,
    sleepType,
    predictedAt,
    windowStart,
    windowEnd,
    routineStart,
    confidence,

    reasons,
    adviceCodes,

    algorithmVersion: prediction.algorithmVersion,

    inputFingerprint: prediction.inputFingerprint ?? null,

    timezone: prediction.timezone ?? "UTC",

    computedAt: validateDate(
      prediction.computedAt ?? new Date(),
      "prediction calculation date",
      true,
    ),

    expiresAt: validateDate(
      prediction.expiresAt ??
        (isPrediction ? new Date(Date.parse(windowEnd) + 60 * 60000) : null),
      "prediction expiration date",
    ),
  };
}

function mapPrediction(row) {
  if (!row) {
    return null;
  }

  return {
    childId: row.child_id,
    status: row.status,
    type: row.sleep_type,

    predictedAt: row.predicted_at?.toISOString() ?? null,
    windowStart: row.window_start?.toISOString() ?? null,
    windowEnd: row.window_end?.toISOString() ?? null,
    routineStart: row.routine_start?.toISOString() ?? null,

    confidence: row.confidence_code,
    reasons: row.reason_codes ?? [],
    adviceCodes: row.advice_codes ?? [],

    algorithmVersion: row.algorithm_version,
    inputFingerprint: row.input_fingerprint,
    timezone: row.timezone,

    computedAt: row.computed_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,

    version: row.version,
  };
}

async function getChildSleepPrediction({ childId, database = pool }) {
  if (!childId) {
    throw new Error("Missing child ID.");
  }

  const result = await database.query(
    `
      SELECT *
      FROM child_sleep_predictions
      WHERE child_id = $1
    `,
    [childId],
  );

  return mapPrediction(result.rows[0]);
}

async function saveChildSleepPrediction({
  childId,
  prediction,
  database = pool,
}) {
  if (!childId) {
    throw new Error("Missing child ID.");
  }

  const data = validatePrediction(prediction);

  if (typeof data.algorithmVersion !== "string" || !data.algorithmVersion) {
    throw new Error("Missing sleep prediction algorithm version.");
  }

  const result = await database.query(
    `
      INSERT INTO child_sleep_predictions (
        child_id,
        status,
        sleep_type,
        predicted_at,
        window_start,
        window_end,
        routine_start,
        confidence_code,
        reason_codes,
        advice_codes,
        algorithm_version,
        input_fingerprint,
        timezone,
        computed_at,
        expires_at,
        version
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9::jsonb, $10::jsonb, $11, $12,
        $13, $14, $15, 1
      )
      ON CONFLICT (child_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        sleep_type = EXCLUDED.sleep_type,
        predicted_at = EXCLUDED.predicted_at,
        window_start = EXCLUDED.window_start,
        window_end = EXCLUDED.window_end,
        routine_start = EXCLUDED.routine_start,
        confidence_code = EXCLUDED.confidence_code,
        reason_codes = EXCLUDED.reason_codes,
        advice_codes = EXCLUDED.advice_codes,
        algorithm_version = EXCLUDED.algorithm_version,
        input_fingerprint = EXCLUDED.input_fingerprint,
        timezone = EXCLUDED.timezone,
        computed_at = EXCLUDED.computed_at,
        expires_at = EXCLUDED.expires_at,
        version = child_sleep_predictions.version + 1
      RETURNING *
    `,
    [
      childId,
      data.status,
      data.sleepType,
      data.predictedAt,
      data.windowStart,
      data.windowEnd,
      data.routineStart,
      data.confidence,
      JSON.stringify(data.reasons),
      JSON.stringify(data.adviceCodes),
      data.algorithmVersion,
      data.inputFingerprint,
      data.timezone,
      data.computedAt,
      data.expiresAt,
    ],
  );

  return mapPrediction(result.rows[0]);
}

module.exports = {
  getChildSleepPrediction,
  saveChildSleepPrediction,
};
