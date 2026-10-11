const pool = require("../../../db/pool");

const { syncRevenueCatSubscriptions } = require("./revenuecatSyncService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUBSCRIPTION_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_PAUSED",
  "EXPIRATION",
  "BILLING_ISSUE",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "REFUND_REVERSED",
]);

// Une ligne récemment expirée doit encore être interrogée. En particulier,
// les renouvellements Sandbox peuvent être visibles dans l'API RevenueCat
// avant ou sans qu'un nouveau webhook exploitable arrive sur cette instance.
const ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "grace_period",
  "cancelled",
  "on_hold",
  "paused",
];

const EXPIRED_RECONCILIATION_HOURS = 24;

function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  const code = error?.code;

  return typeof code === "string" && /^[A-Z0-9_]{1,100}$/.test(code)
    ? code
    : "REVENUECAT_PROCESSING_FAILED";
}

async function finishEvent(id, status) {
  await pool.query(
    `
      UPDATE subscription_events
      SET
        status = $2,
        processed_at = clock_timestamp(),
        next_attempt_at = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
      WHERE id = $1
        AND status IN ('pending', 'failed')
    `,
    [id, status],
  );
}

async function processEvent(row, environment) {
  const event = row.payload?.event;

  if (!event || typeof event.type !== "string") {
    throw workerError("INVALID_REVENUECAT_EVENT");
  }

  if (event.type === "TEST") {
    await finishEvent(row.id, "processed");
    return;
  }

  const eventEnvironment =
    event.environment === "SANDBOX"
      ? "sandbox"
      : event.environment === "PRODUCTION"
        ? "production"
        : null;

  if (event.type === "TRANSFER") {
    // Un transfert ne doit pas conserver un ancien droit local.
    // Invalide les confirmations des comptes concernés, dans
    // l'environnement traité par ce worker.
    const ids = [
      ...(Array.isArray(event.transferred_from) ? event.transferred_from : []),
      ...(Array.isArray(event.transferred_to) ? event.transferred_to : []),
    ]
      .filter((id) => typeof id === "string" && UUID_PATTERN.test(id))
      .map((id) => id.toLowerCase());

    if (ids.length > 0) {
      await pool.query(
        `
          UPDATE subscriptions
          SET
            revenuecat_gives_access = FALSE,
            revenuecat_access_valid_until = NULL,
            updated_at = clock_timestamp()
          WHERE management_provider = 'revenuecat'
            AND environment = $1
            AND revenuecat_app_user_id = ANY($2::text[])
        `,
        [environment, ids],
      );
    }

    throw workerError("REVENUECAT_TRANSFER_REQUIRES_REVIEW");
  }

  if (!eventEnvironment) {
    throw workerError("REVENUECAT_EVENT_ENVIRONMENT_MISSING");
  }

  if (eventEnvironment !== environment) {
    // Ne pas marquer traité : un worker de cet environnement
    // pourra prendre le relais.
    throw workerError("REVENUECAT_EVENT_ENVIRONMENT_MISMATCH");
  }

  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    await finishEvent(row.id, "ignored");
    return;
  }

  if (
    typeof event.app_user_id !== "string" ||
    !UUID_PATTERN.test(event.app_user_id)
  ) {
    throw workerError("REVENUECAT_USER_ID_REQUIRES_REVIEW");
  }

  await syncRevenueCatSubscriptions({
    userId: event.app_user_id,
    requireSubscription: [
      "INITIAL_PURCHASE",
      "RENEWAL",
      "UNCANCELLATION",
    ].includes(event.type),
  });

  await finishEvent(row.id, "processed");
}

async function runRevenueCatWorkerCycle() {
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (!["sandbox", "production"].includes(environment)) {
    throw workerError("INVALID_BILLING_ENVIRONMENT");
  }

  // Un seul worker à la fois par environnement, même si plusieurs
  // instances du processus sont lancées par erreur.
  const lockClient = await pool.connect();
  let hasLock = false;

  try {
    const lock = await lockClient.query(
      `
        SELECT pg_try_advisory_lock(
          726310,
          $1::integer
        ) AS acquired
      `,
      [environment === "sandbox" ? 1 : 2],
    );

    hasLock = lock.rows[0].acquired;

    if (!hasLock) {
      return;
    }

    const events = await pool.query(
      `
        SELECT id, payload
        FROM subscription_events
        WHERE payment_provider = 'revenuecat'
          AND status IN ('pending', 'failed')
          AND (
            environment = $1
            OR environment IS NULL
          )
          AND (
            next_attempt_at IS NULL
            OR next_attempt_at <= clock_timestamp()
          )
        ORDER BY received_at, id
        LIMIT 20
      `,
      [environment],
    );

    for (const row of events.rows) {
      try {
        await processEvent(row, environment);
      } catch (error) {
        const code = safeErrorCode(error);

        await pool.query(
          `
            UPDATE subscription_events
            SET
              status = 'failed',
              attempt_count = attempt_count + 1,
              next_attempt_at =
                clock_timestamp() + INTERVAL '5 minutes',
              last_error = $2,
              updated_at = clock_timestamp()
            WHERE id = $1
              AND status IN ('pending', 'failed')
          `,
          [row.id, code],
        );

        console.error("[RevenueCat event]", row.id, code);
      }
    }

    const customers = await pool.query(
      `
        SELECT
          revenuecat_app_user_id AS user_id,
          MIN(last_verified_at) AS last_verified_at,
          MIN(
            GREATEST(
              COALESCE(last_verified_at, '-infinity'::timestamptz),
              updated_at
            )
          ) AS last_attempt_at,
          BOOL_OR(
            revenuecat_gives_access = TRUE
            OR status = ANY($2::varchar[])
          ) AS active_priority
        FROM subscriptions
        WHERE management_provider = 'revenuecat'
          AND environment = $1
          AND (
            revenuecat_gives_access = TRUE
            OR status = ANY($2::varchar[])
            OR (
              status = 'expired'
              AND current_period_end BETWEEN
                clock_timestamp() - ($3::integer * INTERVAL '1 hour')
                AND
                clock_timestamp() + ($3::integer * INTERVAL '1 hour')
            )
          )
        GROUP BY revenuecat_app_user_id
        HAVING MIN(
          GREATEST(
            COALESCE(last_verified_at, '-infinity'::timestamptz),
            updated_at
          )
        ) <
            clock_timestamp() - INTERVAL '5 minutes'
        ORDER BY
          BOOL_OR(
            revenuecat_gives_access = TRUE
            OR status = ANY($2::varchar[])
          ) DESC,
          MIN(
            GREATEST(
              COALESCE(last_verified_at, '-infinity'::timestamptz),
              updated_at
            )
          ) ASC
        LIMIT 20
      `,
      [
        environment,
        ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES,
        EXPIRED_RECONCILIATION_HOURS,
      ],
    );

    for (const customer of customers.rows) {
      try {
        await syncRevenueCatSubscriptions({
          userId: customer.user_id,
        });
      } catch (error) {
        // Un client en erreur ne doit pas reprendre immédiatement une des
        // vingt places à chaque cycle. `last_verified_at` reste inchangé :
        // aucune vérification d'accès n'est inventée.
        await pool.query(
          `
            UPDATE subscriptions
            SET updated_at = clock_timestamp()
            WHERE management_provider = 'revenuecat'
              AND environment = $1
              AND revenuecat_app_user_id = $2
          `,
          [environment, customer.user_id],
        );

        console.error("[RevenueCat refresh]", safeErrorCode(error));
      }
    }
  } finally {
    try {
      if (hasLock) {
        await lockClient.query(
          `
            SELECT pg_advisory_unlock(
              726310,
              $1::integer
            )
          `,
          [environment === "sandbox" ? 1 : 2],
        );
      }

      lockClient.release();
    } catch (error) {
      // Détruit la connexion si le déverrouillage a échoué.
      lockClient.release(true);
      throw error;
    }
  }
}

module.exports = {
  ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES,
  EXPIRED_RECONCILIATION_HOURS,
  runRevenueCatWorkerCycle,
};
