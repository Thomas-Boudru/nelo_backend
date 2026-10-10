const pool = require("../../../db/pool");

async function saveRevenueCatEvent(payload) {
  const event = payload.event;

  const environment =
    event.environment === "SANDBOX"
      ? "sandbox"
      : event.environment === "PRODUCTION"
        ? "production"
        : null;

  const isTest = event.type === "TEST";

  await pool.query(
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
        'revenuecat',
        $1,
        $2,
        $3,
        $4::jsonb,
        $5::varchar,
        $6::timestamptz,
        CASE
          WHEN $7::boolean THEN NOW()
          ELSE NULL
        END
      )
      ON CONFLICT (payment_provider, provider_event_id)
      DO NOTHING
    `,
    [
      environment,
      event.id,
      event.type,
      JSON.stringify(payload),
      isTest ? "processed" : "pending",
      event.event_timestamp_ms == null
        ? null
        : new Date(event.event_timestamp_ms),
      isTest,
    ],
  );
}

module.exports = {
  saveRevenueCatEvent,
};
