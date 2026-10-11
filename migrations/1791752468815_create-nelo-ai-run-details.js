exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE nelo_ai_run_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      run_id uuid NOT NULL
        REFERENCES nelo_ai_runs(id)
        ON DELETE CASCADE,

      -- Ordre des étapes au sein du traitement.
      sequence_number integer NOT NULL,

      -- Exécutant ayant créé cette étape.
      execution_token uuid NOT NULL,

      step_code varchar(50) NOT NULL,

      -- Facultatif : nom d'un outil autorisé par le backend.
      tool_name varchar(80), 
    
      status varchar(20) NOT NULL DEFAULT 'running',

      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz,

      error_code varchar(100),

      CONSTRAINT nelo_ai_step_sequence_unique
        UNIQUE (run_id, sequence_number),

      CONSTRAINT nelo_ai_step_sequence_check
        CHECK (sequence_number >= 1),

      CONSTRAINT nelo_ai_step_code_check
        CHECK (
          step_code IN (
            'preparing_context',
            'reading_tracking',
            'generating_answer',
            'saving_answer',
            'summarizing_conversation'
          )
        ),

      CONSTRAINT nelo_ai_step_tool_check
        CHECK (
          tool_name IS NULL
          OR tool_name ~ '^[a-z][a-z0-9_]{0,79}$'
        ),

      CONSTRAINT nelo_ai_step_status_check
        CHECK (
          status IN (
            'running',
            'completed',
            'failed',
            'cancelled'
          )
        ),

      CONSTRAINT nelo_ai_step_error_check
        CHECK (
          error_code IS NULL
          OR error_code ~ '^[A-Z0-9_]{1,100}$'
        ),

      CONSTRAINT nelo_ai_step_state_check
        CHECK (
          (
            status = 'running'
            AND finished_at IS NULL
            AND error_code IS NULL
          )
          OR
          (
            status = 'completed'
            AND finished_at IS NOT NULL
            AND error_code IS NULL
          )
          OR
          (
            status IN ('failed', 'cancelled')
            AND finished_at IS NOT NULL
            AND error_code IS NOT NULL
          )
        ),

      CONSTRAINT nelo_ai_step_dates_check
        CHECK (
          finished_at IS NULL
          OR finished_at >= started_at
        )
    );


    CREATE TABLE nelo_ai_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      run_id uuid NOT NULL
        REFERENCES nelo_ai_runs(id)
        ON DELETE CASCADE,

      -- Une nouvelle ligne pour chaque tentative d'appel.
      sequence_number integer NOT NULL,

      execution_token uuid NOT NULL,

      purpose varchar(30) NOT NULL,

      provider varchar(30) NOT NULL DEFAULT 'openai',

      -- Modèle demandé et modèle effectivement indiqué en réponse.
      requested_model varchar(100) NOT NULL,
      response_model varchar(100),

      prompt_version varchar(50) NOT NULL,

      status varchar(20) NOT NULL DEFAULT 'running',

      provider_request_id varchar(255),
      provider_response_id varchar(255),

      -- NULL signifie : consommation inconnue.
      -- Ne pas remplacer par zéro après un timeout.
      input_tokens bigint,
      cached_input_tokens bigint,
      output_tokens bigint,

      -- Sous-ensemble éventuel des tokens de sortie.
      -- Ne pas l'ajouter une seconde fois à output_tokens.
      reasoning_tokens bigint,

      -- Estimation calculée par notre backend.
      estimated_cost_usd numeric(18, 10),

      -- Référence de la grille tarifaire utilisée.
      pricing_version varchar(80),

      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz,

      latency_ms bigint,
      error_code varchar(100),

      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

      CONSTRAINT nelo_ai_call_sequence_unique
        UNIQUE (run_id, sequence_number),

      CONSTRAINT nelo_ai_call_sequence_check
        CHECK (sequence_number >= 1),

      CONSTRAINT nelo_ai_call_purpose_check
        CHECK (
          purpose IN (
            'answer',
            'conversation_summary',
            'conversation_title'
          )
        ),

      CONSTRAINT nelo_ai_call_configuration_check
        CHECK (
          length(trim(provider)) > 0
          AND length(trim(requested_model)) > 0
          AND length(trim(prompt_version)) > 0
          AND (
            response_model IS NULL
            OR length(trim(response_model)) > 0
          )
        ),

      CONSTRAINT nelo_ai_call_status_check
        CHECK (
          status IN (
            'running',
            'completed',
            'failed',
            'cancelled',
            'unknown'
          )
        ),

      CONSTRAINT nelo_ai_call_tokens_check
        CHECK (
          (input_tokens IS NULL OR input_tokens >= 0)
          AND
          (cached_input_tokens IS NULL OR cached_input_tokens >= 0)
          AND
          (output_tokens IS NULL OR output_tokens >= 0)
          AND
          (reasoning_tokens IS NULL OR reasoning_tokens >= 0)
        ),

      CONSTRAINT nelo_ai_call_cached_tokens_check
        CHECK (
          cached_input_tokens IS NULL
          OR (
            input_tokens IS NOT NULL
            AND cached_input_tokens <= input_tokens
          )
        ),

      CONSTRAINT nelo_ai_call_reasoning_tokens_check
        CHECK (
          reasoning_tokens IS NULL
          OR (
            output_tokens IS NOT NULL
            AND reasoning_tokens <= output_tokens
          )
        ),

      CONSTRAINT nelo_ai_call_cost_check
        CHECK (
          (
            estimated_cost_usd IS NULL
            AND pricing_version IS NULL
          )
          OR
          (
            estimated_cost_usd IS NOT NULL
            AND estimated_cost_usd >= 0
            AND pricing_version IS NOT NULL
            AND length(trim(pricing_version)) > 0
            AND input_tokens IS NOT NULL
            AND output_tokens IS NOT NULL
          )
        ),

      CONSTRAINT nelo_ai_call_latency_check
        CHECK (
          latency_ms IS NULL
          OR latency_ms >= 0
        ),

      CONSTRAINT nelo_ai_call_error_check
        CHECK (
          error_code IS NULL
          OR error_code ~ '^[A-Z0-9_]{1,100}$'
        ),

      CONSTRAINT nelo_ai_call_state_check
        CHECK (
          (
            status = 'running'
            AND finished_at IS NULL
            AND error_code IS NULL
          )
          OR
          (
            status = 'completed'
            AND finished_at IS NOT NULL
            AND error_code IS NULL
          )
          OR
          (
            status IN ('failed', 'cancelled', 'unknown')
            AND finished_at IS NOT NULL
            AND error_code IS NOT NULL
          )
        ),

      CONSTRAINT nelo_ai_call_dates_check
        CHECK (
          finished_at IS NULL
          OR finished_at >= started_at
        )
    );

    CREATE INDEX nelo_ai_calls_started_idx
      ON nelo_ai_calls (started_at DESC);

    CREATE INDEX nelo_ai_calls_unresolved_idx
      ON nelo_ai_calls (started_at)
      WHERE status IN ('running', 'unknown');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE nelo_ai_calls;
    DROP TABLE nelo_ai_run_steps;
  `);
};
