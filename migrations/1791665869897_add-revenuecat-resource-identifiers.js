exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE subscription_products
      ADD COLUMN revenuecat_product_id text;

    ALTER TABLE subscription_products
      ADD CONSTRAINT subscription_product_revenuecat_id_check
      CHECK (
        revenuecat_product_id IS NULL
        OR length(trim(revenuecat_product_id)) > 0
      );

    CREATE UNIQUE INDEX subscription_products_revenuecat_id_unique
      ON subscription_products (revenuecat_product_id)
      WHERE revenuecat_product_id IS NOT NULL;

    ALTER TABLE subscriptions
      ADD COLUMN revenuecat_subscription_id text;

    ALTER TABLE subscriptions
      ADD CONSTRAINT subscription_revenuecat_subscription_id_check
      CHECK (
        revenuecat_subscription_id IS NULL
        OR (
          management_provider = 'revenuecat'
          AND length(trim(revenuecat_subscription_id)) > 0
        )
      );

    CREATE UNIQUE INDEX subscriptions_revenuecat_id_unique
      ON subscriptions (
        environment,
        revenuecat_subscription_id
      )
      WHERE revenuecat_subscription_id IS NOT NULL;

    -- Un abonnement RevenueCat est identifié par son ID RevenueCat.
    -- L'identifiant natif du store peut ne pas encore être disponible.
    ALTER TABLE subscriptions
      ALTER COLUMN store_subscription_id DROP NOT NULL;

    ALTER TABLE subscriptions
      ADD CONSTRAINT subscription_management_identity_check
      CHECK (
        (
          management_provider = 'direct'
          AND store_subscription_id IS NOT NULL
        )
        OR
        (
          management_provider = 'revenuecat'
          AND revenuecat_subscription_id IS NOT NULL
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
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

    ALTER TABLE subscriptions
      DROP CONSTRAINT subscription_management_identity_check,
      DROP CONSTRAINT subscription_revenuecat_subscription_id_check;

    ALTER TABLE subscriptions
      ALTER COLUMN store_subscription_id SET NOT NULL;

    DROP INDEX subscriptions_revenuecat_id_unique;

    ALTER TABLE subscriptions
      DROP COLUMN revenuecat_subscription_id;

    DROP INDEX subscription_products_revenuecat_id_unique;

    ALTER TABLE subscription_products
      DROP CONSTRAINT subscription_product_revenuecat_id_check,
      DROP COLUMN revenuecat_product_id;
  `);
};
