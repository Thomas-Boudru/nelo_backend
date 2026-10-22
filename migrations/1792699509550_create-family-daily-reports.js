exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE family_daily_report_settings (
      family_id UUID PRIMARY KEY
        REFERENCES families(id) ON DELETE CASCADE,

      enabled BOOLEAN NOT NULL DEFAULT false,

      language_code VARCHAR(10) NOT NULL DEFAULT 'en',
      time_zone TEXT,

      delivery_hour SMALLINT NOT NULL DEFAULT 7,

      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT family_daily_report_language_check
        CHECK (
          language_code IN ('en', 'fr', 'de', 'es', 'it', 'nl', 'pt')
        ),

      CONSTRAINT family_daily_report_hour_check
        CHECK (delivery_hour BETWEEN 0 AND 23),

      CONSTRAINT family_daily_report_timezone_check
        CHECK (
          time_zone IS NULL
          OR length(btrim(time_zone)) > 0
        ),

      CONSTRAINT family_daily_report_enabled_check
        CHECK (
          enabled = false
          OR time_zone IS NOT NULL
        )
    );

    CREATE TABLE child_daily_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      family_id UUID NOT NULL
        REFERENCES families(id) ON DELETE CASCADE,

      child_id UUID NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,

      environment VARCHAR(20) NOT NULL,
      report_date DATE NOT NULL,

      language_code VARCHAR(10) NOT NULL,
      time_zone TEXT NOT NULL,

      period_started_at TIMESTAMPTZ NOT NULL,
      period_ended_at TIMESTAMPTZ NOT NULL,

      status VARCHAR(30) NOT NULL DEFAULT 'pending',

      scheduled_at TIMESTAMPTZ NOT NULL,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      attempt_count INTEGER NOT NULL DEFAULT 0,

      execution_token UUID,
      lease_expires_at TIMESTAMPTZ,

      input_hash TEXT,
      data_cutoff_at TIMESTAMPTZ,

      content_json JSONB,

      model_name TEXT,
      prompt_version TEXT,

      input_tokens BIGINT,
      output_tokens BIGINT,

      last_error_code VARCHAR(100),

      generated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT child_daily_reports_environment_check
        CHECK (environment IN ('sandbox', 'production')),

      CONSTRAINT child_daily_reports_language_check
        CHECK (
          language_code IN ('en', 'fr', 'de', 'es', 'it', 'nl', 'pt')
        ),

      CONSTRAINT child_daily_reports_timezone_check
        CHECK (length(btrim(time_zone)) > 0),

      CONSTRAINT child_daily_reports_period_check
        CHECK (period_ended_at > period_started_at),

      CONSTRAINT child_daily_reports_status_check
        CHECK (
          status IN (
            'pending',
            'generating',
            'ready',
            'insufficient_data',
            'failed',
            'cancelled'
          )
        ),

      CONSTRAINT child_daily_reports_attempts_check
        CHECK (attempt_count >= 0),

      CONSTRAINT child_daily_reports_lease_check
        CHECK (
          (
            status = 'generating'
            AND execution_token IS NOT NULL
            AND lease_expires_at IS NOT NULL
          )
          OR
          (
            status <> 'generating'
            AND execution_token IS NULL
            AND lease_expires_at IS NULL
          )
        ),

      CONSTRAINT child_daily_reports_content_check
        CHECK (
          content_json IS NULL
          OR jsonb_typeof(content_json) = 'object'
        ),

      CONSTRAINT child_daily_reports_ready_check
        CHECK (
          status <> 'ready'
          OR (
            content_json IS NOT NULL
            AND generated_at IS NOT NULL
            AND data_cutoff_at IS NOT NULL
            AND input_hash IS NOT NULL
            AND model_name IS NOT NULL
            AND prompt_version IS NOT NULL
          )
        ),

      CONSTRAINT child_daily_reports_input_tokens_check
        CHECK (input_tokens IS NULL OR input_tokens >= 0),

      CONSTRAINT child_daily_reports_output_tokens_check
        CHECK (output_tokens IS NULL OR output_tokens >= 0),

      CONSTRAINT child_daily_reports_unique_day
        UNIQUE (
          environment,
          family_id,
          child_id,
          report_date
        )
    );

    CREATE INDEX idx_child_daily_reports_pending
      ON child_daily_reports (
        environment,
        next_attempt_at,
        scheduled_at,
        id
      )
      WHERE status = 'pending';

    CREATE INDEX idx_child_daily_reports_expired_lease
      ON child_daily_reports (
        environment,
        lease_expires_at,
        id
      )
      WHERE status = 'generating';

    CREATE INDEX idx_child_daily_reports_history
      ON child_daily_reports (
        family_id,
        child_id,
        environment,
        report_date DESC
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE child_daily_reports;
    DROP TABLE family_daily_report_settings;
  `);
};
