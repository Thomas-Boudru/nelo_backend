const { createHash, randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const { getFamilyEntitlements } = require("./familyEntitlementsService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceError(code, message, status, details = undefined) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function validateUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw serviceError("INVALID_REQUEST", `A valid ${label} is required.`, 400);
  }
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT;

  if (!["sandbox", "production"].includes(environment)) {
    throw serviceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  return environment;
}

// Trie les clés pour que l'ordre des propriétés JSON
// ne change pas l'empreinte de la demande.
function canonicalJson(value) {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  throw serviceError(
    "INVALID_USAGE_REQUEST",
    "The usage request must contain valid JSON data.",
    400,
  );
}

function makeRequestHash({ requestData, units }) {
  return createHash("sha256")
    .update(canonicalJson({ requestData, units }))
    .digest("hex");
}

async function withTransaction(callback, transactionClient = null) {
  /*
   * Lorsqu'un client est fourni, la transaction appartient à l'appelant.
   * Ce service ne doit donc ni la valider, ni l'annuler, ni libérer le client.
   *
   * L'appelant doit avoir exécuté BEGIN et doit faire ROLLBACK
   * si une erreur remonte.
   */
  if (transactionClient !== null) {
    if (
      typeof transactionClient.query !== "function" ||
      typeof transactionClient.release !== "function"
    ) {
      throw serviceError(
        "INVALID_TRANSACTION_CLIENT",
        "A dedicated database transaction client is required.",
        500,
      );
    }

    return callback(transactionClient);
  }

  // Comportement actuel conservé pour les appels autonomes.
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      console.error("[Feature usage] Transaction rollback failed.");
    }

    throw error;
  } finally {
    client.release();
  }
}

function mapOperation(row, replayed) {
  return {
    operationId: row.id,
    familyId: row.family_id,
    featureCode: row.feature_code,
    status: row.status,
    units: row.units,
    replayed,
    resultReference: row.result_reference,
  };
}

async function reserveFeatureUsage({
  familyId,
  userId,
  featureCode,
  idempotencyKey,
  requestData,
  units = 1,
  transactionClient = null,
}) {
  validateUuid(familyId, "family ID");
  validateUuid(userId, "user ID");
  validateUuid(idempotencyKey, "idempotency key");

  familyId = familyId.toLowerCase();
  userId = userId.toLowerCase();
  idempotencyKey = idempotencyKey.toLowerCase();

  if (
    typeof featureCode !== "string" ||
    !/^[a-z][a-z0-9_]{0,79}$/.test(featureCode)
  ) {
    throw serviceError(
      "INVALID_FEATURE",
      "The requested feature is invalid.",
      400,
    );
  }

  if (!Number.isSafeInteger(units) || units < 1 || units > 2147483647) {
    throw serviceError(
      "INVALID_USAGE_UNITS",
      "The usage units are invalid.",
      400,
    );
  }

  const environment = getEnvironment();
  const requestHash = makeRequestHash({ requestData, units });

  return withTransaction(async (client) => {
    // Sérialise les mutations de quota de cette famille.
    // Le verrou est libéré avant tout appel à l'IA.
    const access = await client.query(
      `
        SELECT f.id

        FROM families f

        WHERE f.id = $1
          AND f.deleted_at IS NULL

          AND EXISTS (
            SELECT 1
            FROM family_members fm
            JOIN users u ON u.id = fm.user_id
            WHERE fm.family_id = f.id
              AND fm.user_id = $2
              AND fm.removed_at IS NULL
              AND u.deleted_at IS NULL
              AND u.status = 'active'
          )

        FOR UPDATE OF f
      `,
      [familyId, userId],
    );

    if (access.rowCount === 0) {
      throw serviceError(
        "FAMILY_NOT_FOUND",
        "The family could not be found.",
        404,
      );
    }

    const existing = await client.query(
      `
        SELECT *
        FROM feature_usage_operations
        WHERE family_id = $1
          AND feature_code = $2
          AND environment = $3
          AND idempotency_key = $4
      `,
      [familyId, featureCode, environment, idempotencyKey],
    );

    if (existing.rowCount > 0) {
      const operation = existing.rows[0];

      if (
        operation.requested_by_user_id !== userId.toLowerCase() ||
        operation.request_hash !== requestHash
      ) {
        throw serviceError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key belongs to another request.",
          409,
        );
      }

      return mapOperation(operation, true);
    }

    const entitlements = await getFamilyEntitlements({
      familyId,
      userId,
      database: client,
    });

    const feature = entitlements.features[featureCode];

    if (!feature?.enabled) {
      throw serviceError(
        "FEATURE_NOT_AVAILABLE",
        "This feature is not available for your family.",
        403,
        {
          featureCode,
          planCode: entitlements.planCode ?? null,
        },
      );
    }

    // Une fonction sans quota doit avoir son propre contrôle
    // de fréquence. Ce service ne l'autorise pas implicitement.
    if (!feature.quota) {
      throw serviceError(
        "FEATURE_QUOTA_NOT_CONFIGURED",
        "This feature does not have a configured usage quota.",
        500,
      );
    }

    const quota = feature.quota;

    const counter = await client.query(
      `
        INSERT INTO feature_usage (
          family_id,
          feature_code,
          environment,
          quota_period,
          period_starts_at,
          period_ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)

        ON CONFLICT (
          family_id,
          feature_code,
          environment,
          quota_period,
          period_starts_at
        )
        DO NOTHING
      `,
      [
        familyId,
        featureCode,
        environment,
        quota.period,
        quota.startsAt,
        quota.resetsAt,
      ],
    );

    const reserved = await client.query(
      `
        UPDATE feature_usage
        SET reserved_units = reserved_units + $6,
            updated_at = NOW()

        WHERE family_id = $1
          AND feature_code = $2
          AND environment = $3
          AND quota_period = $4
          AND period_starts_at = $5

          AND used_units::bigint
              + reserved_units::bigint
              + $6::bigint <= $7::bigint

        RETURNING id
      `,
      [
        familyId,
        featureCode,
        environment,
        quota.period,
        quota.startsAt,
        units,
        quota.limit,
      ],
    );

    if (reserved.rowCount === 0) {
      const counterResult = await client.query(
        `
      SELECT used_units, reserved_units
      FROM feature_usage
      WHERE family_id = $1::uuid
        AND feature_code = $2
        AND environment = $3
        AND quota_period = $4
        AND period_starts_at = $5::timestamptz
    `,
        [familyId, featureCode, environment, quota.period, quota.startsAt],
      );

      const counter = counterResult.rows[0];

      if (!counter) {
        throw serviceError(
          "USAGE_COUNTER_INCONSISTENT",
          "The usage counter could not be found.",
          500,
        );
      }

      const used = Number(counter.used_units);
      const reservedUnits = Number(counter.reserved_units);
      const limit = Number(quota.limit);

      throw serviceError(
        "FEATURE_QUOTA_EXCEEDED",
        "Your family has reached the usage limit for this feature.",
        429,
        {
          featureCode,
          planCode: entitlements.planCode ?? null,
          quota: {
            limit,
            used,
            reserved: reservedUnits,
            remaining: Math.max(0, limit - used - reservedUnits),
            period: quota.period,
            resetsAt: quota.resetsAt,
          },
        },
      );
    }

    const operation = await client.query(
      `
        INSERT INTO feature_usage_operations (
          id,
          usage_id,
          family_id,
          feature_code,
          environment,
          requested_by_user_id,
          idempotency_key,
          request_hash,
          units,
          quota_limit_at_reservation,
          reconcile_after
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          NOW() + INTERVAL '15 minutes'
        )
        RETURNING *
      `,
      [
        randomUUID(),
        reserved.rows[0].id,
        familyId,
        featureCode,
        environment,
        userId,
        idempotencyKey,
        requestHash,
        units,
        quota.limit,
      ],
    );

    return mapOperation(operation.rows[0], false);
  }, transactionClient);
}

// Fonctions internes au backend.
// Ne pas exposer une route publique permettant de les appeler.
async function settleFeatureUsage({
  operationId,
  targetStatus,
  resultReference = null,
  reason = null,
  transactionClient = null,
}) {
  validateUuid(operationId, "operation ID");

  operationId = operationId.toLowerCase();

  if (!["completed", "released"].includes(targetStatus)) {
    throw serviceError(
      "INVALID_USAGE_STATUS",
      "The usage operation status is invalid.",
      500,
    );
  }

  const environment = getEnvironment();
  if (
    targetStatus === "released" &&
    (typeof reason !== "string" || !reason.trim())
  ) {
    throw serviceError(
      "MISSING_RELEASE_REASON",
      "A release reason is required.",
      400,
    );
  }

  if (
    resultReference !== null &&
    (typeof resultReference !== "string" || !resultReference.trim())
  ) {
    throw serviceError(
      "INVALID_RESULT_REFERENCE",
      "The result reference is invalid.",
      400,
    );
  }

  return withTransaction(async (client) => {
    const lookup = await client.query(
      `
        SELECT family_id
        FROM feature_usage_operations
        WHERE id = $1 AND environment = $2
      `,
      [operationId, environment],
    );

    if (lookup.rowCount === 0) {
      throw serviceError(
        "USAGE_OPERATION_NOT_FOUND",
        "The usage operation could not be found.",
        404,
      );
    }

    // Même ordre de verrouillage que la réservation.
    await client.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [
      lookup.rows[0].family_id,
    ]);

    const found = await client.query(
      `
        SELECT *
        FROM feature_usage_operations
        WHERE id = $1 AND environment = $2
        FOR UPDATE
      `,
      [operationId, environment],
    );

    const operation = found.rows[0];

    if (operation.status === targetStatus) {
      if (
        targetStatus === "completed" &&
        operation.result_reference !== resultReference
      ) {
        throw serviceError(
          "USAGE_RESULT_CONFLICT",
          "This operation already has a different result.",
          409,
        );
      }

      return mapOperation(operation, true);
    }

    if (operation.status !== "reserved") {
      throw serviceError(
        "USAGE_OPERATION_ALREADY_SETTLED",
        "This usage operation has already been settled.",
        409,
      );
    }

    const completed = targetStatus === "completed";

    const updatedCounter = await client.query(
      `
        UPDATE feature_usage
        SET reserved_units = reserved_units - $2,
            used_units = used_units + $3,
            updated_at = NOW()

        WHERE id = $1
          AND reserved_units >= $2

        RETURNING id
      `,
      [operation.usage_id, operation.units, completed ? operation.units : 0],
    );

    if (updatedCounter.rowCount === 0) {
      throw serviceError(
        "USAGE_COUNTER_INCONSISTENT",
        "The usage counter is inconsistent.",
        500,
      );
    }

    const updated = await client.query(
      `
    UPDATE feature_usage_operations
    SET
      status = $2::varchar,
      completed_at = CASE
        WHEN $2::varchar = 'completed' THEN NOW()
        ELSE NULL
      END,
      released_at = CASE
        WHEN $2::varchar = 'released' THEN NOW()
        ELSE NULL
      END,
      release_reason = $3::text,
      result_reference = $4::text,
      updated_at = NOW()
    WHERE id = $1::uuid
    RETURNING *
  `,
      [
        operationId,
        targetStatus,
        completed ? null : reason.trim(),
        completed ? resultReference : null,
      ],
    );

    return mapOperation(updated.rows[0], false);
  }, transactionClient);
}

async function completeFeatureUsage({
  operationId,
  resultReference = null,
  transactionClient = null,
}) {
  return settleFeatureUsage({
    operationId,
    targetStatus: "completed",
    resultReference,
    transactionClient,
  });
}

async function releaseFeatureUsage({
  operationId,
  reason,
  transactionClient = null,
}) {
  return settleFeatureUsage({
    operationId,
    targetStatus: "released",
    reason,
    transactionClient,
  });
}

module.exports = {
  reserveFeatureUsage,
  completeFeatureUsage,
  releaseFeatureUsage,
};
