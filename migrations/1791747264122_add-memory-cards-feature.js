exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO subscription_plan_features (
      plan_code,
      feature_code,
      access_level,
      quota_limit,
      quota_period
    )
    VALUES
      ('free', 'memory_cards', 'disabled', NULL, NULL),
      ('premium', 'memory_cards', 'enabled', NULL, NULL);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM subscription_plan_features
    WHERE feature_code = 'memory_cards'
      AND plan_code IN ('free', 'premium');
  `);
};
