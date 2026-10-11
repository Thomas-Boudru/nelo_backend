exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE subscriptions
      ADD COLUMN revenuecat_gives_access boolean
        NOT NULL DEFAULT FALSE,

      ADD COLUMN revenuecat_access_valid_until timestamptz;

    ALTER TABLE subscriptions
      ADD CONSTRAINT subscription_revenuecat_access_check
      CHECK (
        NOT revenuecat_gives_access
        OR (
          management_provider = 'revenuecat'
          AND last_verified_at IS NOT NULL
          AND revenuecat_access_valid_until IS NOT NULL
          AND revenuecat_access_valid_until > last_verified_at
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE subscriptions
      DROP CONSTRAINT subscription_revenuecat_access_check,
      DROP COLUMN revenuecat_access_valid_until,
      DROP COLUMN revenuecat_gives_access;
  `);
};
