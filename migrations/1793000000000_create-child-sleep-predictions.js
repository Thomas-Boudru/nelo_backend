exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE child_sleep_predictions (
      child_id UUID PRIMARY KEY
        REFERENCES children(id)
        ON DELETE CASCADE,

      status VARCHAR(30) NOT NULL,

      sleep_type VARCHAR(20),

      predicted_at TIMESTAMPTZ,
      window_start TIMESTAMPTZ,
      window_end TIMESTAMPTZ,
      routine_start TIMESTAMPTZ,

      confidence_code VARCHAR(20),

      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      advice_codes JSONB NOT NULL DEFAULT '[]'::jsonb,

      algorithm_version VARCHAR(30) NOT NULL,
      input_fingerprint VARCHAR(128),

      timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',

      computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,

      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT child_sleep_predictions_status_check
        CHECK (
          status IN (
            'prediction',
            'learning',
            'sleeping',
            'unavailable'
          )
        ),

      CONSTRAINT child_sleep_predictions_type_check
        CHECK (
          sleep_type IS NULL
          OR sleep_type IN ('nap', 'bedtime')
        ),

      CONSTRAINT child_sleep_predictions_confidence_check
        CHECK (
          confidence_code IS NULL
          OR confidence_code IN ('low', 'good', 'high')
        ),

      CONSTRAINT child_sleep_predictions_version_check
        CHECK (version >= 1),

      CONSTRAINT child_sleep_predictions_window_check
        CHECK (
          status <> 'prediction'
          OR (
            sleep_type IS NOT NULL
            AND predicted_at IS NOT NULL
            AND window_start IS NOT NULL
            AND window_end IS NOT NULL
            AND window_start <= predicted_at
            AND predicted_at <= window_end
          )
        ),

      CONSTRAINT child_sleep_predictions_reasons_check
        CHECK (jsonb_typeof(reason_codes) = 'array'),

      CONSTRAINT child_sleep_predictions_advice_check
        CHECK (jsonb_typeof(advice_codes) = 'array')
    );

    CREATE INDEX idx_child_sleep_predictions_expires
      ON child_sleep_predictions(expires_at)
      WHERE status = 'prediction';

    CREATE INDEX idx_child_sleep_predictions_window_start
      ON child_sleep_predictions(window_start)
      WHERE status = 'prediction';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS child_sleep_predictions;
  `);
};
