exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE subscription_gifts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      plan_code varchar(30) NOT NULL
        REFERENCES subscription_plans(code),

      -- Peut être NULL si l'acheteur n'a pas de compte Nelo.
      purchased_by_user_id uuid
        REFERENCES users(id),

      purchaser_email text NOT NULL,

      recipient_email text,
      recipient_name varchar(150),
      personal_message varchar(1000),

      duration_months smallint NOT NULL,

      environment varchar(20) NOT NULL,

      status varchar(30) NOT NULL DEFAULT 'pending_payment',

      -- Empreinte du code secret, jamais le code en clair.
      -- Créée uniquement après validation du paiement.
      code_hash text UNIQUE,

      payment_provider varchar(30),
      provider_payment_id text,

      -- Montant dans l'unité mineure : centimes pour EUR.
      amount_paid_minor bigint,
      currency varchar(3),
      paid_at timestamptz,

      -- Date limite pour activer le cadeau.
      -- Ce n'est pas la fin de l'accès Premium.
      redeem_before timestamptz,

      redeemed_by_user_id uuid
        REFERENCES users(id),

      redeemed_family_id uuid
        REFERENCES families(id),

      redeemed_at timestamptz,

      refunded_at timestamptz,
      revoked_at timestamptz,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT subscription_gift_duration_check
        CHECK (duration_months > 0),

      CONSTRAINT subscription_gift_environment_check
        CHECK (environment IN ('sandbox', 'production')),

      CONSTRAINT subscription_gift_status_check
        CHECK (
          status IN (
            'pending_payment',
            'available',
            'redeemed',
            'expired',
            'refunded',
            'revoked'
          )
        ),

      CONSTRAINT subscription_gift_email_check
        CHECK (length(trim(purchaser_email)) > 0),

      CONSTRAINT subscription_gift_code_check
        CHECK (
          code_hash IS NULL
          OR length(trim(code_hash)) > 0
        ),

      CONSTRAINT subscription_gift_amount_check
        CHECK (
          amount_paid_minor IS NULL
          OR amount_paid_minor >= 0
        ),

      CONSTRAINT subscription_gift_currency_check
        CHECK (
          currency IS NULL
          OR currency ~ '^[A-Z]{3}$'
        ),

      CONSTRAINT subscription_gift_payment_identity_check
        CHECK (
          (
            payment_provider IS NULL
            AND provider_payment_id IS NULL
          )
          OR
          (
            payment_provider IS NOT NULL
            AND provider_payment_id IS NOT NULL
            AND length(trim(payment_provider)) > 0
            AND length(trim(provider_payment_id)) > 0
          )
        ),

      CONSTRAINT subscription_gift_paid_details_check
        CHECK (
          paid_at IS NULL
          OR (
            payment_provider IS NOT NULL
            AND provider_payment_id IS NOT NULL
            AND amount_paid_minor IS NOT NULL
            AND currency IS NOT NULL
          )
        ),

      CONSTRAINT subscription_gift_activation_ready_check
        CHECK (
          status NOT IN ('available', 'redeemed')
          OR (
            paid_at IS NOT NULL
            AND code_hash IS NOT NULL
          )
        ),

      CONSTRAINT subscription_gift_redemption_details_check
        CHECK (
          (
            redeemed_at IS NULL
            AND redeemed_by_user_id IS NULL
            AND redeemed_family_id IS NULL
          )
          OR
          (
            redeemed_at IS NOT NULL
            AND redeemed_by_user_id IS NOT NULL
            AND redeemed_family_id IS NOT NULL
          )
        ),

      CONSTRAINT subscription_gift_redemption_status_check
        CHECK (
          (
            status = 'redeemed'
            AND redeemed_at IS NOT NULL
          )
          OR
          (
            status IN ('refunded', 'revoked')
          )
          OR
          (
            status IN (
              'pending_payment',
              'available',
              'expired'
            )
            AND redeemed_at IS NULL
          )
        ),

      CONSTRAINT subscription_gift_redemption_payment_check
        CHECK (
          redeemed_at IS NULL
          OR (
            paid_at IS NOT NULL
            AND redeemed_at >= paid_at
          )
        ),

      CONSTRAINT subscription_gift_payment_unique
        UNIQUE (
          payment_provider,
          environment,
          provider_payment_id
        ),

      -- Permet de vérifier le bénéficiaire du droit accordé.
      CONSTRAINT subscription_gift_beneficiary_unique
        UNIQUE (
          id,
          redeemed_family_id,
          plan_code,
          environment
        )
    );


    CREATE TABLE family_access_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      family_id uuid NOT NULL
        REFERENCES families(id),

      plan_code varchar(30) NOT NULL
        REFERENCES subscription_plans(code),

      environment varchar(20) NOT NULL,

      -- Un cadeau ne peut créer qu'un seul droit d'accès.
      gift_id uuid NOT NULL UNIQUE,

      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,

      revoked_at timestamptz,
      revocation_reason text,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT family_access_grant_environment_check
        CHECK (environment IN ('sandbox', 'production')),

      CONSTRAINT family_access_grant_period_check
        CHECK (ends_at > starts_at),

      CONSTRAINT family_access_grant_gift_fk
        FOREIGN KEY (
          gift_id,
          family_id,
          plan_code,
          environment
        )
        REFERENCES subscription_gifts (
          id,
          redeemed_family_id,
          plan_code,
          environment
        )
    );


    CREATE INDEX subscription_gifts_purchaser_idx
      ON subscription_gifts (purchased_by_user_id);

    CREATE INDEX subscription_gifts_family_idx
      ON subscription_gifts (redeemed_family_id);

    CREATE INDEX subscription_gifts_expiration_idx
      ON subscription_gifts (redeem_before)
      WHERE status = 'available';

    CREATE INDEX family_access_grants_family_period_idx
      ON family_access_grants (
        family_id,
        environment,
        ends_at
      )
      WHERE revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE family_access_grants;
    DROP TABLE subscription_gifts;
  `);
};
