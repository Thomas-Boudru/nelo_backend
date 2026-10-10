exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE subscriptions
      ADD COLUMN management_provider varchar(30)
        NOT NULL DEFAULT 'direct',

      ADD COLUMN revenuecat_app_user_id text;

    ALTER TABLE subscriptions
      ADD CONSTRAINT subscription_management_provider_check
      CHECK (
        management_provider IN ('direct', 'revenuecat')
      ),

      ADD CONSTRAINT subscription_revenuecat_identity_check
      CHECK (
        (
          management_provider = 'direct'
          AND revenuecat_app_user_id IS NULL
        )
        OR
        (
          management_provider = 'revenuecat'
          AND revenuecat_app_user_id IS NOT NULL
          AND length(trim(revenuecat_app_user_id)) > 0
        )
      );

    CREATE INDEX subscriptions_revenuecat_customer_idx
      ON subscriptions (
        revenuecat_app_user_id,
        environment
      )
      WHERE management_provider = 'revenuecat';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Refuse un retour arrière qui effacerait le rattachement
    -- d'abonnements déjà gérés par RevenueCat.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE management_provider = 'revenuecat'
      ) THEN
        RAISE EXCEPTION
          'Cannot revert: RevenueCat-managed subscriptions exist.';
      END IF;
    END
    $$;

    DROP INDEX subscriptions_revenuecat_customer_idx;

    ALTER TABLE subscriptions
      DROP CONSTRAINT subscription_revenuecat_identity_check,
      DROP CONSTRAINT subscription_management_provider_check;

    ALTER TABLE subscriptions
      DROP COLUMN revenuecat_app_user_id,
      DROP COLUMN management_provider;
  `);
};
