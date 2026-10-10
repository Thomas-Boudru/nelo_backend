exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE subscription_purchase_intents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      purchased_by_user_id uuid
        REFERENCES users(id),

      family_id uuid
        REFERENCES families(id),

      product_id uuid
        REFERENCES subscription_products(id),

      gift_id uuid
        REFERENCES subscription_gifts(id),

      purchase_kind varchar(20) NOT NULL,

      payment_provider varchar(30) NOT NULL,

      environment varchar(20) NOT NULL,

      -- Clé fournie pour reconnaître une demande rejouée.
      idempotency_key uuid NOT NULL UNIQUE,

      -- Empreinte des paramètres initiaux.
      -- Une même clé ne doit pas accepter un achat différent.
      request_hash text NOT NULL,

      status varchar(30) NOT NULL DEFAULT 'pending',

      expires_at timestamptz NOT NULL,
      completed_at timestamptz,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT purchase_intent_kind_check
        CHECK (
          purchase_kind IN ('subscription', 'gift')
        ),

      CONSTRAINT purchase_intent_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT purchase_intent_provider_check
        CHECK (length(trim(payment_provider)) > 0),

      CONSTRAINT purchase_intent_hash_check
        CHECK (length(trim(request_hash)) > 0),

      CONSTRAINT purchase_intent_status_check
        CHECK (
          status IN (
            'pending',
            'processing',
            'completed',
            'cancelled',
            'expired',
            'failed'
          )
        ),

      CONSTRAINT purchase_intent_target_check
        CHECK (
          (
            purchase_kind = 'subscription'
            AND purchased_by_user_id IS NOT NULL
            AND family_id IS NOT NULL
            AND product_id IS NOT NULL
            AND gift_id IS NULL
            AND payment_provider IN ('app_store', 'play_store')
          )
          OR
          (
            purchase_kind = 'gift'
            AND gift_id IS NOT NULL
            AND family_id IS NULL
            AND product_id IS NULL
          )
        ),

      CONSTRAINT purchase_intent_expiration_check
        CHECK (expires_at > created_at),

      CONSTRAINT purchase_intent_completion_check
        CHECK (
          (status = 'completed' AND completed_at IS NOT NULL)
          OR
          (status <> 'completed' AND completed_at IS NULL)
        )
    );


    CREATE TABLE subscription_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      subscription_id uuid
        REFERENCES subscriptions(id),

      gift_id uuid
        REFERENCES subscription_gifts(id),

      purchase_intent_id uuid
        REFERENCES subscription_purchase_intents(id),

      payment_provider varchar(30) NOT NULL,

      environment varchar(20) NOT NULL,

      -- Identifiant unique du paiement ou du renouvellement.
      -- Pour Google, ne pas utiliser seulement le purchaseToken :
      -- il peut être commun à plusieurs renouvellements.
      provider_transaction_id text NOT NULL,

      transaction_kind varchar(30) NOT NULL,

      status varchar(30) NOT NULL DEFAULT 'paid',

      purchased_at timestamptz NOT NULL,

      period_starts_at timestamptz,
      period_ends_at timestamptz,

      -- NULL si le fournisseur ne donne pas un montant fiable.
      amount_paid_minor bigint,
      currency varchar(3),

      refunded_at timestamptz,
      revoked_at timestamptz,

      -- Confirmations techniques après attribution des droits.
      acknowledgement_required boolean NOT NULL DEFAULT FALSE,
      acknowledged_at timestamptz,
      acknowledgement_attempt_count integer NOT NULL DEFAULT 0,
      acknowledgement_next_attempt_at timestamptz,
      acknowledgement_last_error text,

      verified_at timestamptz NOT NULL,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT subscription_transaction_target_check
        CHECK (
          (
            subscription_id IS NOT NULL
            AND gift_id IS NULL
            AND transaction_kind IN (
              'initial_purchase',
              'renewal'
            )
          )
          OR
          (
            subscription_id IS NULL
            AND gift_id IS NOT NULL
            AND transaction_kind = 'gift_purchase'
          )
        ),

      CONSTRAINT subscription_transaction_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT subscription_transaction_provider_check
        CHECK (length(trim(payment_provider)) > 0),

      CONSTRAINT subscription_transaction_identifier_check
        CHECK (length(trim(provider_transaction_id)) > 0),

      CONSTRAINT subscription_transaction_status_check
        CHECK (
          status IN (
            'paid',
            'partially_refunded',
            'refunded',
            'revoked'
          )
        ),

      CONSTRAINT subscription_transaction_amount_check
        CHECK (
          amount_paid_minor IS NULL
          OR amount_paid_minor >= 0
        ),

      CONSTRAINT subscription_transaction_currency_check
        CHECK (
          currency IS NULL
          OR currency ~ '^[A-Z]{3}$'
        ),

      CONSTRAINT subscription_transaction_money_check
        CHECK (
          (amount_paid_minor IS NULL AND currency IS NULL)
          OR
          (amount_paid_minor IS NOT NULL AND currency IS NOT NULL)
        ),

      CONSTRAINT subscription_transaction_period_check
        CHECK (
          (
            period_starts_at IS NULL
            AND period_ends_at IS NULL
          )
          OR
          (
            period_starts_at IS NOT NULL
            AND period_ends_at IS NOT NULL
            AND period_ends_at > period_starts_at
          )
        ),

      CONSTRAINT subscription_transaction_attempt_count_check
        CHECK (acknowledgement_attempt_count >= 0),

      CONSTRAINT subscription_transaction_provider_unique
        UNIQUE (
          payment_provider,
          environment,
          provider_transaction_id
        )
    );


    CREATE TABLE subscription_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      payment_provider varchar(30) NOT NULL,

      -- Peut être inconnu à la réception.
      -- Sera déterminé lors de la vérification.
      environment varchar(20),

      provider_event_id text NOT NULL,
      event_type varchar(120) NOT NULL,

      subscription_id uuid
        REFERENCES subscriptions(id),

      gift_id uuid
        REFERENCES subscription_gifts(id),

      payload jsonb NOT NULL,

      status varchar(20) NOT NULL DEFAULT 'pending',

      occurred_at timestamptz,
      received_at timestamptz NOT NULL DEFAULT NOW(),

      attempt_count integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz,

      -- Permet de reprendre un traitement interrompu.
      locked_at timestamptz,
      lock_token uuid,

      processed_at timestamptz,
      last_error text,

      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT subscription_event_provider_check
        CHECK (length(trim(payment_provider)) > 0),

      CONSTRAINT subscription_event_identifier_check
        CHECK (length(trim(provider_event_id)) > 0),

      CONSTRAINT subscription_event_environment_check
        CHECK (
          environment IS NULL
          OR environment IN ('sandbox', 'production')
        ),

      CONSTRAINT subscription_event_status_check
        CHECK (
          status IN (
            'pending',
            'processing',
            'processed',
            'failed',
            'ignored'
          )
        ),

      CONSTRAINT subscription_event_target_check
        CHECK (
          subscription_id IS NULL
          OR gift_id IS NULL
        ),

      CONSTRAINT subscription_event_payload_check
        CHECK (jsonb_typeof(payload) = 'object'),

      CONSTRAINT subscription_event_attempt_count_check
        CHECK (attempt_count >= 0),

      CONSTRAINT subscription_event_lock_check
        CHECK (
          (
            status = 'processing'
            AND locked_at IS NOT NULL
            AND lock_token IS NOT NULL
          )
          OR
          (
            status <> 'processing'
            AND locked_at IS NULL
            AND lock_token IS NULL
          )
        ),

      CONSTRAINT subscription_event_provider_unique
        UNIQUE (payment_provider, provider_event_id)
    );


    CREATE INDEX purchase_intents_user_idx
      ON subscription_purchase_intents (purchased_by_user_id);

    CREATE INDEX purchase_intents_family_idx
      ON subscription_purchase_intents (family_id);

    CREATE INDEX purchase_intents_gift_idx
      ON subscription_purchase_intents (gift_id);

    CREATE INDEX purchase_intents_expiration_idx
      ON subscription_purchase_intents (expires_at)
      WHERE status = 'pending';


    CREATE INDEX subscription_transactions_subscription_idx
      ON subscription_transactions (
        subscription_id,
        purchased_at DESC
      );

    CREATE INDEX subscription_transactions_gift_idx
      ON subscription_transactions (gift_id);

    CREATE INDEX subscription_transactions_intent_idx
      ON subscription_transactions (purchase_intent_id);

    CREATE INDEX subscription_transactions_acknowledgement_idx
      ON subscription_transactions (
        acknowledgement_next_attempt_at
      )
      WHERE acknowledgement_required = TRUE
        AND acknowledged_at IS NULL;


    CREATE INDEX subscription_events_retry_idx
      ON subscription_events (next_attempt_at, received_at)
      WHERE status IN ('pending', 'failed');

    CREATE INDEX subscription_events_lock_idx
      ON subscription_events (locked_at)
      WHERE status = 'processing';

    CREATE INDEX subscription_events_subscription_idx
      ON subscription_events (subscription_id);

    CREATE INDEX subscription_events_gift_idx
      ON subscription_events (gift_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE subscription_events;
    DROP TABLE subscription_transactions;
    DROP TABLE subscription_purchase_intents;
  `);
};
