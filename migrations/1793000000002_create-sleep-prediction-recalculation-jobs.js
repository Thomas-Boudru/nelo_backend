exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sleep_prediction_recalculation_jobs (
      child_id UUID PRIMARY KEY
        REFERENCES children(id) ON DELETE CASCADE,

      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      generation BIGINT NOT NULL DEFAULT 1,

      status VARCHAR(20) NOT NULL DEFAULT 'pending',

      attempt_count INTEGER NOT NULL DEFAULT 0,

      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      last_error TEXT,

      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT sleep_prediction_jobs_status_check
        CHECK (status IN ('pending', 'processing')),

      CONSTRAINT sleep_prediction_jobs_attempt_check
        CHECK (attempt_count >= 0),

      CONSTRAINT sleep_prediction_jobs_generation_check
        CHECK (generation >= 1)
    );

    CREATE INDEX idx_sleep_prediction_jobs_due
      ON sleep_prediction_recalculation_jobs (
        next_attempt_at,
        requested_at
      )
      WHERE status = 'pending';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS sleep_prediction_recalculation_jobs;
  `);
};
