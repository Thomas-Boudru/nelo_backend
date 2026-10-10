exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE subscription_plans (
      code varchar(30) PRIMARY KEY,
      name varchar(100) NOT NULL,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    );

    CREATE TABLE subscription_plan_features (
      plan_code varchar(30) NOT NULL
        REFERENCES subscription_plans(code),

      feature_code varchar(80) NOT NULL,

      access_level varchar(30) NOT NULL,

      quota_limit integer,
      quota_period varchar(20),

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      PRIMARY KEY (plan_code, feature_code),

      CONSTRAINT subscription_feature_access_check
        CHECK (
          access_level IN (
            'disabled',
            'basic',
            'advanced',
            'enabled'
          )
        ),

      CONSTRAINT subscription_feature_quota_check
        CHECK (
          (
            quota_limit IS NULL
            AND quota_period IS NULL
          )
          OR
          (
            quota_limit IS NOT NULL
            AND quota_limit >= 0
            AND quota_period IS NOT NULL
            AND quota_period IN ('day', 'month')
          )
        )
    );

    INSERT INTO subscription_plans (code, name)
    VALUES
      ('free', 'Free'),
      ('premium', 'Premium');

    INSERT INTO subscription_plan_features (
      plan_code,
      feature_code,
      access_level,
      quota_limit,
      quota_period
    )
    VALUES
      ('free', 'tracking', 'enabled', NULL, NULL),
      ('premium', 'tracking', 'enabled', NULL, NULL),

      ('free', 'family_sharing', 'enabled', NULL, NULL),
      ('premium', 'family_sharing', 'enabled', NULL, NULL),

      ('free', 'daily_summary', 'basic', NULL, NULL),
      ('premium', 'daily_summary', 'advanced', NULL, NULL),

      ('free', 'trends', 'basic', NULL, NULL),
      ('premium', 'trends', 'advanced', NULL, NULL),

      ('free', 'sleep_prediction', 'basic', NULL, NULL),
      ('premium', 'sleep_prediction', 'advanced', NULL, NULL),

      ('free', 'assistant', 'enabled', 3, 'day'),
      ('premium', 'assistant', 'enabled', 30, 'day'),

      ('free', 'voice_entry', 'basic', 1, 'day'),
      ('premium', 'voice_entry', 'advanced', 30, 'day'),

      ('free', 'journal', 'basic', NULL, NULL),
      ('premium', 'journal', 'advanced', NULL, NULL),

      ('free', 'medical_export', 'basic', NULL, NULL),
      ('premium', 'medical_export', 'advanced', NULL, NULL);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE subscription_plan_features;
    DROP TABLE subscription_plans;
  `);
};
