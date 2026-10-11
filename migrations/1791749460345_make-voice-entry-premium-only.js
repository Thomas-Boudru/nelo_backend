exports.up = (pgm) => {
  pgm.sql(`
    UPDATE subscription_plan_features
    SET
      access_level = 'disabled',
      quota_limit = NULL,
      quota_period = NULL,
      updated_at = NOW()
    WHERE plan_code = 'free'
      AND feature_code = 'voice_entry';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE subscription_plan_features
    SET
      access_level = 'basic',
      quota_limit = 1,
      quota_period = 'day',
      updated_at = NOW()
    WHERE plan_code = 'free'
      AND feature_code = 'voice_entry';
  `);
};
