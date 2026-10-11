exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE revenuecat_family_bindings (
      user_id uuid NOT NULL
        REFERENCES users(id),

      environment varchar(20) NOT NULL,

      family_id uuid NOT NULL
        REFERENCES families(id),

      created_at timestamptz NOT NULL DEFAULT NOW(),

      PRIMARY KEY (user_id, environment),

      CONSTRAINT revenuecat_family_binding_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        )
    );

    CREATE INDEX revenuecat_family_bindings_family_idx
      ON revenuecat_family_bindings (family_id);

    ALTER TABLE subscription_purchase_intents
      ADD COLUMN management_provider varchar(30)
        NOT NULL DEFAULT 'direct';

    ALTER TABLE subscription_purchase_intents
      ADD CONSTRAINT purchase_intent_management_provider_check
      CHECK (
        management_provider IN ('direct', 'revenuecat')
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM revenuecat_family_bindings
      ) OR EXISTS (
        SELECT 1
        FROM subscription_purchase_intents
        WHERE management_provider = 'revenuecat'
      ) THEN
        RAISE EXCEPTION
          'Cannot revert: RevenueCat purchase bindings exist.';
      END IF;
    END
    $$;

    ALTER TABLE subscription_purchase_intents
      DROP CONSTRAINT purchase_intent_management_provider_check;

    ALTER TABLE subscription_purchase_intents
      DROP COLUMN management_provider;

    DROP TABLE revenuecat_family_bindings;
  `);
};
