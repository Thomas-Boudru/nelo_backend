exports.up = (pgm) => {
  pgm.sql(`
    -- Ces clés permettent aux relations ci-dessous de contrôler
    -- la cohérence entre conversation, utilisateur et famille.

    ALTER TABLE nelo_conversations
      ADD CONSTRAINT nelo_conversations_run_scope_unique
      UNIQUE (id, user_id, family_id, child_id);

    ALTER TABLE nelo_messages
      ADD CONSTRAINT nelo_messages_run_scope_unique
      UNIQUE (id, conversation_id, role);

    ALTER TABLE feature_usage_operations
      ADD CONSTRAINT feature_usage_operations_run_scope_unique
      UNIQUE (
        id,
        family_id,
        feature_code,
        environment,
        requested_by_user_id
      );


    CREATE TABLE nelo_ai_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      conversation_id uuid NOT NULL,
      user_id uuid NOT NULL,
      family_id uuid NOT NULL,
      child_id uuid NOT NULL,

      environment varchar(20) NOT NULL,

      -- Chaque question correspond à une réservation existante.
      usage_operation_id uuid NOT NULL,

      feature_code varchar(80) NOT NULL DEFAULT 'assistant',

      user_message_id uuid NOT NULL,
      user_message_role varchar(20) NOT NULL DEFAULT 'user',

      assistant_message_id uuid,
      assistant_message_role varchar(20) NOT NULL DEFAULT 'assistant',

      status varchar(20) NOT NULL DEFAULT 'queued',

      -- Code technique traduit par le frontend.
      -- Aucun prénom ou contenu personnel dans ce champ.
      current_step varchar(50) NOT NULL DEFAULT 'queued',

      locale varchar(20) NOT NULL,
      timezone varchar(100) NOT NULL,

      -- Version des instructions utilisées pour cette réponse.
      prompt_version varchar(50) NOT NULL,

      -- Budget maximal partagé entre les appels du traitement.
      max_tool_calls integer NOT NULL DEFAULT 4,
      tool_call_count integer NOT NULL DEFAULT 0,

      -- Propriété temporaire du traitement.
      -- Permettra de rejeter les écritures d'un ancien exécutant.
      execution_token uuid,
      lease_expires_at timestamptz,
      heartbeat_at timestamptz,

      started_at timestamptz,
      finished_at timestamptz,

      -- Code technique uniquement, sans réponse brute du fournisseur.
      error_code varchar(100),

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT nelo_ai_run_conversation_scope_fk
        FOREIGN KEY (
          conversation_id,
          user_id,
          family_id,
          child_id
        )
        REFERENCES nelo_conversations (
          id,
          user_id,
          family_id,
          child_id
        ),

      CONSTRAINT nelo_ai_run_usage_scope_fk
        FOREIGN KEY (
          usage_operation_id,
          family_id,
          feature_code,
          environment,
          user_id
        )
        REFERENCES feature_usage_operations (
          id,
          family_id,
          feature_code,
          environment,
          requested_by_user_id
        ),

      CONSTRAINT nelo_ai_run_user_message_fk
        FOREIGN KEY (
          user_message_id,
          conversation_id,
          user_message_role
        )
        REFERENCES nelo_messages (
          id,
          conversation_id,
          role
        ),

      CONSTRAINT nelo_ai_run_assistant_message_fk
        FOREIGN KEY (
          assistant_message_id,
          conversation_id,
          assistant_message_role
        )
        REFERENCES nelo_messages (
          id,
          conversation_id,
          role
        ),

      CONSTRAINT nelo_ai_run_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT nelo_ai_run_feature_check
        CHECK (feature_code = 'assistant'),

      CONSTRAINT nelo_ai_run_message_roles_check
        CHECK (
          user_message_role = 'user'
          AND assistant_message_role = 'assistant'
        ),

      CONSTRAINT nelo_ai_run_status_check
        CHECK (
          status IN (
            'queued',
            'running',
            'completed',
            'failed',
            'cancelled'
          )
        ),

      CONSTRAINT nelo_ai_run_step_check
        CHECK (
          current_step IN (
            'queued',
            'preparing_context',
            'reading_tracking',
            'generating_answer',
            'saving_answer',
            'completed',
            'failed',
            'cancelled'
          )
        ),

      CONSTRAINT nelo_ai_run_configuration_check
        CHECK (
          length(trim(locale)) > 0
          AND length(trim(timezone)) > 0
          AND length(trim(prompt_version)) > 0
        ),

      CONSTRAINT nelo_ai_run_tool_budget_check
        CHECK (
          max_tool_calls BETWEEN 0 AND 20
          AND tool_call_count >= 0
          AND tool_call_count <= max_tool_calls
        ),

      CONSTRAINT nelo_ai_run_error_code_check
        CHECK (
          error_code IS NULL
          OR error_code ~ '^[A-Z0-9_]{1,100}$'
        ),

      CONSTRAINT nelo_ai_run_state_check
        CHECK (
          (
            status = 'queued'
            AND current_step = 'queued'
            AND started_at IS NULL
            AND finished_at IS NULL
            AND assistant_message_id IS NULL
            AND error_code IS NULL
          )
          OR
          (
            status = 'running'
            AND current_step IN (
              'preparing_context',
              'reading_tracking',
              'generating_answer',
              'saving_answer'
            )
            AND started_at IS NOT NULL
            AND finished_at IS NULL
            AND assistant_message_id IS NULL
            AND error_code IS NULL
          )
          OR
          (
            status = 'completed'
            AND current_step = 'completed'
            AND started_at IS NOT NULL
            AND finished_at IS NOT NULL
            AND assistant_message_id IS NOT NULL
            AND error_code IS NULL
          )
          OR
          (
            status IN ('failed', 'cancelled')
            AND current_step = status
            AND finished_at IS NOT NULL
            AND assistant_message_id IS NULL
            AND error_code IS NOT NULL
          )
        ),

      CONSTRAINT nelo_ai_run_lease_check
        CHECK (
          (
            status = 'running'
            AND execution_token IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND heartbeat_at IS NOT NULL
            AND lease_expires_at > heartbeat_at
          )
          OR
          (
            status <> 'running'
            AND execution_token IS NULL
            AND lease_expires_at IS NULL
          )
        ),

      CONSTRAINT nelo_ai_run_dates_check
        CHECK (
          (started_at IS NULL OR started_at >= created_at)
          AND
          (finished_at IS NULL OR finished_at >= created_at)
          AND
          (
            started_at IS NULL
            OR finished_at IS NULL
            OR finished_at >= started_at
          )
        ),

      CONSTRAINT nelo_ai_run_usage_unique
        UNIQUE (usage_operation_id),

      CONSTRAINT nelo_ai_run_user_message_unique
        UNIQUE (user_message_id),

      CONSTRAINT nelo_ai_run_assistant_message_unique
        UNIQUE (assistant_message_id)
    );


    -- Une seule réponse en préparation par conversation :
    -- évite deux réponses concurrentes sur un historique différent.
    CREATE UNIQUE INDEX nelo_ai_runs_one_pending_per_conversation_idx
      ON nelo_ai_runs (conversation_id)
      WHERE status IN ('queued', 'running');

    CREATE INDEX nelo_ai_runs_conversation_idx
      ON nelo_ai_runs (conversation_id, created_at DESC, id);

    CREATE INDEX nelo_ai_runs_queue_idx
      ON nelo_ai_runs (environment, created_at, id)
      WHERE status = 'queued';

    CREATE INDEX nelo_ai_runs_expired_lease_idx
      ON nelo_ai_runs (environment, lease_expires_at)
      WHERE status = 'running';

    CREATE INDEX nelo_ai_runs_user_idx
      ON nelo_ai_runs (user_id);

    CREATE INDEX nelo_ai_runs_family_idx
      ON nelo_ai_runs (family_id);

    CREATE INDEX nelo_ai_runs_child_idx
      ON nelo_ai_runs (child_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE nelo_ai_runs;

    ALTER TABLE feature_usage_operations
      DROP CONSTRAINT feature_usage_operations_run_scope_unique;

    ALTER TABLE nelo_messages
      DROP CONSTRAINT nelo_messages_run_scope_unique;

    ALTER TABLE nelo_conversations
      DROP CONSTRAINT nelo_conversations_run_scope_unique;
  `);
};
