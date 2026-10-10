exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE subscription_products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      plan_code varchar(30) NOT NULL
        REFERENCES subscription_plans(code),

      store varchar(20) NOT NULL,

      store_product_id text NOT NULL,

      -- Vide pour Apple.
      -- Identifiant du forfait de base pour Google.
      store_base_plan_id text NOT NULL DEFAULT '',

      billing_period varchar(20) NOT NULL,

      is_available_for_purchase boolean NOT NULL DEFAULT FALSE,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT subscription_product_store_check
        CHECK (
          store IN ('app_store', 'play_store')
        ),

      CONSTRAINT subscription_product_period_check
        CHECK (
          billing_period IN ('month', 'year')
        ),

      CONSTRAINT subscription_product_identifier_check
        CHECK (
          length(trim(store_product_id)) > 0
        ),

      CONSTRAINT subscription_product_base_plan_check
        CHECK (
          (
            store = 'app_store'
            AND store_base_plan_id = ''
          )
          OR
          (
            store = 'play_store'
            AND length(trim(store_base_plan_id)) > 0
          )
        ),

      CONSTRAINT subscription_product_store_identity_unique
        UNIQUE (
          store,
          store_product_id,
          store_base_plan_id
        ),

      CONSTRAINT subscription_product_id_store_unique
        UNIQUE (id, store)
    );


    CREATE TABLE subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      family_id uuid NOT NULL
        REFERENCES families(id),

      purchased_by_user_id uuid NOT NULL
        REFERENCES users(id),

      product_id uuid NOT NULL,

      store varchar(20) NOT NULL,

      environment varchar(20) NOT NULL,

      -- Apple : originalTransactionId.
      -- Google : purchaseToken.
      store_subscription_id text NOT NULL,

      status varchar(30) NOT NULL DEFAULT 'pending',

      current_period_start timestamptz,
      current_period_end timestamptz,

      -- Date limite du droit d'accès confirmé par le store.
      -- Peut inclure une période de grâce.
      access_expires_at timestamptz,

      trial_ends_at timestamptz,
      grace_period_ends_at timestamptz,

      auto_renew_enabled boolean NOT NULL DEFAULT FALSE,

      cancelled_at timestamptz,
      revoked_at timestamptz,

      last_verified_at timestamptz,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT subscription_product_store_fk
        FOREIGN KEY (product_id, store)
        REFERENCES subscription_products(id, store),

      CONSTRAINT subscription_store_check
        CHECK (
          store IN ('app_store', 'play_store')
        ),

      CONSTRAINT subscription_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT subscription_status_check
        CHECK (
          status IN (
            'pending',
            'active',
            'grace_period',
            'cancelled',
            'on_hold',
            'paused',
            'expired',
            'revoked'
          )
        ),

      CONSTRAINT subscription_identifier_check
        CHECK (
          length(trim(store_subscription_id)) > 0
        ),

      CONSTRAINT subscription_period_check
        CHECK (
          current_period_start IS NULL
          OR current_period_end IS NULL
          OR current_period_end >= current_period_start
        ),

      CONSTRAINT subscription_store_identity_unique
        UNIQUE (
          store,
          environment,
          store_subscription_id
        )
    );


    CREATE INDEX subscriptions_family_access_idx
      ON subscriptions (
        family_id,
        environment,
        access_expires_at DESC
      );

    CREATE INDEX subscriptions_purchaser_idx
      ON subscriptions (purchased_by_user_id);

    CREATE INDEX subscriptions_product_idx
      ON subscriptions (product_id);

    CREATE INDEX subscriptions_verification_idx
      ON subscriptions (last_verified_at)
      WHERE status IN (
        'pending',
        'active',
        'grace_period',
        'cancelled',
        'on_hold',
        'paused'
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE subscriptions;
    DROP TABLE subscription_products;
  `);
};
