const crypto = require("node:crypto");

const pool = require("../../db/pool");

const { predictNextSleep } = require("./sleepPredictionEngine.js");

const { SLEEP_PREDICTION_CONFIG } = require("./sleepPredictionRules.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function toIso(value) {
  if (value == null) return null;

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid sleep prediction date.");
  }

  return date.toISOString();
}

function mapPrediction(row) {
  if (!row) return null;

  return {
    childId: row.child_id,
    status: row.status,
    reason: ["learning", "unavailable"].includes(row.status)
      ? (row.reason_codes?.[0]?.type ?? null)
      : null,
    type: row.sleep_type,

    predictedAt: toIso(row.predicted_at),
    windowStart: toIso(row.window_start),
    windowEnd: toIso(row.window_end),
    routineStart: toIso(row.routine_start),

    confidence: row.confidence_code,

    reasons: row.reason_codes ?? [],
    adviceCodes: row.advice_codes ?? [],

    algorithmVersion: row.algorithm_version,
    inputFingerprint: row.input_fingerprint,
    timezone: row.timezone,

    computedAt: toIso(row.computed_at),
    expiresAt: toIso(row.expires_at),

    version: row.version,
  };
}

function mapChild(row) {
  return {
    status: row.birth_status,
    birthDate: row.birth_date,
    isPremature:
      row.gestational_age_weeks != null && row.gestational_age_weeks < 37,
    gestationalAgeWeeks: row.gestational_age_weeks,
    gestationalAgeDays: row.gestational_age_days,
  };
}

function mapSleep(row) {
  return {
    id: row.id,
    type: "sleep",
    sleepType: row.sleep_type,

    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),

    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,

    syncStatus: "synced",
    source: row.source,
  };
}

function createInputFingerprint({
  child,
  entries,
  timezone,
  algorithmVersion,
}) {
  const input = {
    child,
    timezone,
    algorithmVersion,

    sleeps: entries
      .map((entry) => ({
        id: entry.id,
        sleepType: entry.sleepType,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        deletedAt: entry.deletedAt,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

async function readPrediction(client, childId) {
  const result = await client.query(
    `
      SELECT *
      FROM child_sleep_predictions
      WHERE child_id = $1
    `,
    [childId],
  );

  return mapPrediction(result.rows[0]);
}

async function loadChild(client, childId) {
  const result = await client.query(
    `
    SELECT
      id,
      birth_status,
      birth_date::text AS birth_date,
      gestational_age_weeks,
      gestational_age_days,
      sleep_timezone
    FROM children
    WHERE id = $1
      AND deleted_at IS NULL
  `,
    [childId],
  );

  return result.rows[0] ?? null;
}

async function loadSleepHistory(client, childId, now) {
  const historyStart = new Date(
    now.getTime() - SLEEP_PREDICTION_CONFIG.historyDays * DAY_MS,
  );

  const result = await client.query(
    `
      SELECT
        t.id,
        t.started_at,
        t.ended_at,
        t.deleted_at,
        t.source,
        s.sleep_type
      FROM tracking_entries t
      INNER JOIN sleep_details s
        ON s.tracking_entry_id = t.id
      WHERE t.child_id = $1
        AND t.entry_type = 'sleep'
        AND t.deleted_at IS NULL
        AND t.started_at <= $2
        AND (
          t.ended_at IS NULL
          OR t.ended_at > $3
        )
      ORDER BY t.started_at ASC, t.id ASC
    `,
    [childId, now.toISOString(), historyStart.toISOString()],
  );

  return result.rows.map(mapSleep);
}

function preparePredictionForStorage({
  prediction,
  timezone,
  inputFingerprint,
}) {
  const isPrediction = prediction.status === "prediction";

  const expiresAt =
    isPrediction && prediction.windowEnd
      ? new Date(
          Date.parse(prediction.windowEnd) + 60 * MINUTE_MS,
        ).toISOString()
      : null;

  return {
    status: prediction.status,
    sleepType: prediction.type ?? null,

    predictedAt: prediction.predictedAt ?? null,
    windowStart: prediction.windowStart ?? null,
    windowEnd: prediction.windowEnd ?? null,
    routineStart: prediction.routineStart ?? null,

    confidence: prediction.confidence ?? null,

    reasons:
      prediction.reasons ??
      (prediction.reason ? [{ type: prediction.reason }] : []),

    adviceCodes: prediction.advice
      ? [{ code: prediction.advice, params: {} }]
      : [],

    algorithmVersion: prediction.algorithmVersion,
    inputFingerprint,
    timezone,

    computedAt: prediction.computedAt ?? new Date().toISOString(),

    expiresAt,
  };
}

/**
 * Recalcule et sauvegarde la prédiction courante.
 *
 * Le verrou advisory transactionnel empêche
 * deux calculs simultanés pour le même enfant.
 */
async function recalculateChildSleepPrediction({ childId }) {
  if (!childId) {
    throw new Error("Missing child ID.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verrou exclusif par enfant pendant le recalcul.
    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1::text, 0)
        )
      `,
      [childId],
    );

    const childRow = await loadChild(client, childId);

    if (!childRow) {
      throw new Error("Child not found.");
    }

    // Ne pas inventer de fuseau si l'enfant
    // n'en possède pas encore.
    const timezone = childRow.sleep_timezone;

    if (!timezone) {
      await client.query("COMMIT");

      return {
        skipped: true,
        reason: "missing_sleep_timezone",
      };
    }

    const now = new Date();

    const child = mapChild(childRow);

    const entries = await loadSleepHistory(client, childId, now);

    const prediction = predictNextSleep({
      child,
      entries,
      now,
      timezone,
    });

    const inputFingerprint = createInputFingerprint({
      child,
      entries,
      timezone,
      algorithmVersion: prediction.algorithmVersion,
    });

    const data = preparePredictionForStorage({
      prediction,
      timezone,
      inputFingerprint,
    });

    const result = await client.query(
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

    await client.query("COMMIT");

    return {
      skipped: false,
      prediction: mapPrediction(result.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getStoredChildSleepPrediction({ childId }) {
  if (!childId) {
    throw new Error("Missing child ID.");
  }

  return readPrediction(pool, childId);
}

async function getChildSleepPredictionForUser({ childId, userId }) {
  if (!childId || !userId) {
    const error = new Error("Missing child ID or user ID.");
    error.status = 400;
    error.code = "MISSING_CHILD_OR_USER_ID";
    throw error;
  }

  const { requireChildTrackingAccess } = require("../tracking/trackingAccess");

  await requireChildTrackingAccess({
    childId,
    userId,
  });

  let stored = await getStoredChildSleepPrediction({
    childId,
  });

  const nowMs = Date.now();

  const isMissing = !stored;

  const expiresAtMs = stored?.expiresAt ? Date.parse(stored.expiresAt) : NaN;

  const isExpired =
    stored?.status === "prediction" &&
    (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs);

  if (isMissing || isExpired) {
    try {
      const result = await recalculateChildSleepPrediction({
        childId,
      });

      if (result.skipped) {
        return {
          childId,
          status: "unavailable",
          reason: result.reason,
        };
      }

      stored = result.prediction;
    } catch (error) {
      console.error("[SleepPrediction] On-demand recalculation failed:", {
        childId,
        message: error.message,
      });

      const serviceError = new Error(
        "Sleep prediction is temporarily unavailable.",
      );

      serviceError.status = 503;
      serviceError.code = "SLEEP_PREDICTION_UNAVAILABLE";

      throw serviceError;
    }
  }

  return stored;
}

module.exports = {
  recalculateChildSleepPrediction,
  getStoredChildSleepPrediction,
  getChildSleepPredictionForUser,
};
