const { randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const { getAppleBillingConnection } = require("./appleBillingClient");

const {
  synchronizeAppleSubscriptionFromNotification,
} = require("./applePurchaseService");

const MAX_ATTEMPTS = 12;
const LOCK_DURATION_MINUTES = 10;

// Types traités ici par relecture de l'état actuel auprès d'Apple.
// Les autres restent visibles en erreur pour traitement spécifique.
const SUBSCRIPTION_EVENTS = new Set([
  "SUBSCRIBED",
  "DID_RENEW",
  "DID_FAIL_TO_RENEW",
  "DID_CHANGE_RENEWAL_STATUS",
  "DID_CHANGE_RENEWAL_PREF",
  "EXPIRED",
  "GRACE_PERIOD_EXPIRED",
  "REFUND",
  "REFUND_REVERSED",
  "REFUND_DECLINED",
  "REVOKE",
  "OFFER_REDEEMED",
  "PRICE_INCREASE",
  "RENEWAL_EXTENDED",
]);

function processingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  const code = error?.code;

  return typeof code === "string" && /^[A-Za-z0-9_]{1,100}$/.test(code)
    ? code
    : "APPLE_EVENT_PROCESSING_FAILED";
}

async function recoverAbandonedEvents(environment) {
  // Une interruption du programme ne doit pas bloquer un événement
  // indéfiniment dans l'état processing.
  await pool.query(
    `
      UPDATE subscription_events
      SET status = 'failed',
          locked_at = NULL,
          lock_token = NULL,
          next_attempt_at = CASE
            WHEN attempt_count < $2::integer THEN NOW()
            ELSE NULL
          END,
          last_error = 'APPLE_EVENT_PROCESSING_INTERRUPTED',
          updated_at = NOW()
      WHERE payment_provider = 'app_store'
        AND environment = $1
        AND status = 'processing'
        AND locked_at <
          NOW() - ($3::integer * INTERVAL '1 minute')
    `,
    [environment, MAX_ATTEMPTS, LOCK_DURATION_MINUTES],
  );
}

async function claimNextEvent(environment) {
  const lockToken = randomUUID();

  // Sélection et réservation atomiques.
  const result = await pool.query(
    `
      WITH candidate AS (
        SELECT id
        FROM subscription_events
        WHERE payment_provider = 'app_store'
          AND environment = $1
          AND attempt_count < $3::integer
          AND (
            (
              status = 'pending'
              AND (
                next_attempt_at IS NULL
                OR next_attempt_at <= NOW()
              )
            )
            OR (
              status = 'failed'
              AND next_attempt_at IS NOT NULL
              AND next_attempt_at <= NOW()
            )
          )
        ORDER BY received_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE subscription_events AS event
      SET status = 'processing',
          locked_at = NOW(),
          lock_token = $2::uuid,
          attempt_count = event.attempt_count + 1,
          next_attempt_at = NULL,
          processed_at = NULL,
          updated_at = NOW()
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING event.*
    `,
    [environment, lockToken, MAX_ATTEMPTS],
  );

  return result.rows[0] ?? null;
}

async function markProcessed(event, subscriptionId = null) {
  const result = await pool.query(
    `
      UPDATE subscription_events
      SET status = 'processed',
          subscription_id = COALESCE($3::uuid, subscription_id),
          processed_at = NOW(),
          locked_at = NULL,
          lock_token = NULL,
          next_attempt_at = NULL,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND lock_token = $2::uuid
        AND status = 'processing'
      RETURNING id
    `,
    [event.id, event.lock_token, subscriptionId],
  );

  // Un ancien traitement ne doit pas finaliser la réservation
  // reprise par un autre programme.
  return result.rowCount === 1;
}

async function markFailed(event, error) {
  const code = safeErrorCode(error);

  const requiresIntervention = [
    "APPLE_EVENT_TYPE_NOT_SUPPORTED",
    "APPLE_EVENT_TRANSACTION_MISSING",
    "APPLE_EVENT_PAYLOAD_MISMATCH",
  ].includes(code);

  const retry = !requiresIntervention && event.attempt_count < MAX_ATTEMPTS;

  // 30 s, 60 s, 120 s... puis au maximum une heure.
  const delaySeconds = Math.min(
    3600,
    30 * 2 ** Math.min(event.attempt_count - 1, 10),
  );

  const result = await pool.query(
    `
      UPDATE subscription_events
      SET status = 'failed',
          locked_at = NULL,
          lock_token = NULL,
          next_attempt_at = CASE
            WHEN $3::boolean
            THEN NOW() + ($4::integer * INTERVAL '1 second')
            ELSE NULL
          END,
          last_error = $5,
          updated_at = NOW()
      WHERE id = $1
        AND lock_token = $2::uuid
        AND status = 'processing'
      RETURNING id
    `,
    [event.id, event.lock_token, retry, delaySeconds, code],
  );

  if (result.rowCount === 1) {
    console.error("Apple notification processing failed:", {
      eventId: event.id,
      eventType: event.event_type,
      attempt: event.attempt_count,
      code,
      retryScheduled: retry,
    });
  }

  return result.rowCount === 1;
}

async function processEvent(event) {
  // Le payload provient exclusivement du webhook qui a vérifié
  // la signature avant l'enregistrement en base.
  const notification = event.payload?.notification;

  if (
    notification?.notificationUUID !== event.provider_event_id ||
    notification?.notificationType !== event.event_type
  ) {
    throw processingError("APPLE_EVENT_PAYLOAD_MISMATCH");
  }

  if (event.event_type === "TEST") {
    return null;
  }

  if (!SUBSCRIPTION_EVENTS.has(event.event_type)) {
    throw processingError("APPLE_EVENT_TYPE_NOT_SUPPORTED");
  }

  const transactionId = event.payload?.transaction?.transactionId;

  if (
    typeof transactionId !== "string" ||
    !/^[0-9]{1,64}$/.test(transactionId)
  ) {
    throw processingError("APPLE_EVENT_TRANSACTION_MISSING");
  }

  // Cette fonction interroge Apple et vérifie à nouveau
  // la transaction avant toute modification de l'abonnement.
  const result = await synchronizeAppleSubscriptionFromNotification({
    transactionId,
  });

  return result.subscription.id;
}

async function processAppleEvents({ limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("The batch limit must be between 1 and 100.");
  }

  const { billingEnvironment } = getAppleBillingConnection();

  await recoverAbandonedEvents(billingEnvironment);

  const summary = {
    environment: billingEnvironment,
    claimed: 0,
    processed: 0,
    failed: 0,
    lostOwnership: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const event = await claimNextEvent(billingEnvironment);

    if (!event) {
      break;
    }

    summary.claimed += 1;

    try {
      const subscriptionId = await processEvent(event);
      const updated = await markProcessed(event, subscriptionId);

      if (updated) {
        summary.processed += 1;
      } else {
        summary.lostOwnership += 1;
      }
    } catch (error) {
      const updated = await markFailed(event, error);

      if (updated) {
        summary.failed += 1;
      } else {
        summary.lostOwnership += 1;
      }
    }
  }

  return summary;
}

module.exports = {
  processAppleEvents,
};
