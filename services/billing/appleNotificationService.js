const pool = require("../../db/pool");

const { getAppleBillingConnection } = require("./appleBillingClient");

const { verifyAppleNotification } = require("./appleVerificationService");

function notificationError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function receiveAppleNotification({ signedPayload }) {
  const { billingEnvironment } = getAppleBillingConnection();

  let verified;

  try {
    verified = await verifyAppleNotification({ signedPayload });
  } catch (error) {
    // Ne pas enregistrer le contenu reçu si sa vérification échoue.
    // Une erreur temporaire de vérification doit pouvoir être retentée.
    throw notificationError(
      "APPLE_NOTIFICATION_VERIFICATION_FAILED",
      "Unable to verify the Apple notification.",
      503,
    );
  }

  const { notification } = verified;

  if (
    !notification ||
    typeof notification.notificationUUID !== "string" ||
    !notification.notificationUUID ||
    typeof notification.notificationType !== "string" ||
    !notification.notificationType
  ) {
    throw notificationError(
      "INVALID_APPLE_NOTIFICATION",
      "The Apple notification is incomplete.",
      400,
    );
  }

  const occurredAt = new Date(notification.signedDate);

  if (
    !Number.isSafeInteger(notification.signedDate) ||
    notification.signedDate <= 0 ||
    Number.isNaN(occurredAt.getTime())
  ) {
    throw notificationError(
      "INVALID_APPLE_NOTIFICATION_DATE",
      "The Apple notification date is invalid.",
      400,
    );
  }

  // Une notification TEST ne nécessite aucune modification d'abonnement.
  const isTest = notification.notificationType === "TEST";

  const result = await pool.query(
    `
      INSERT INTO subscription_events (
        payment_provider,
        environment,
        provider_event_id,
        event_type,
        payload,
        status,
        occurred_at,
        processed_at
      )
            VALUES (
        'app_store',
        $1,
        $2,
        $3,
        $4::jsonb,
        $5::varchar,
        $6,
        CASE
          WHEN $5::varchar = 'processed' THEN NOW()
          ELSE NULL
        END
      )
      ON CONFLICT (payment_provider, provider_event_id)
      DO NOTHING
      RETURNING id
    `,
    [
      billingEnvironment,
      notification.notificationUUID,
      notification.notificationType,
      JSON.stringify({
        signedPayload,
        notification,
        transaction: verified.transaction ?? null,
        renewal: verified.renewal ?? null,
      }),
      isTest ? "processed" : "pending",
      occurredAt,
    ],
  );

  return {
    received: true,
    duplicate: result.rowCount === 0,
  };
}

module.exports = {
  receiveAppleNotification,
};
