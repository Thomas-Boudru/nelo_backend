exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE feature_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      family_id uuid NOT NULL
        REFERENCES families(id),

      feature_code varchar(80) NOT NULL,

      environment varchar(20) NOT NULL,

      quota_period varchar(20) NOT NULL,

      period_starts_at timestamptz NOT NULL,
      period_ends_at timestamptz NOT NULL,

      -- Opérations terminées avec succès.
      used_units integer NOT NULL DEFAULT 0,

      -- Quota réservé pour les opérations en cours.
      reserved_units integer NOT NULL DEFAULT 0,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT feature_usage_feature_check
        CHECK (length(trim(feature_code)) > 0),

      CONSTRAINT feature_usage_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT feature_usage_quota_period_check
        CHECK (
          quota_period IN ('day', 'month')
        ),

      CONSTRAINT feature_usage_dates_check
        CHECK (period_ends_at > period_starts_at),

      CONSTRAINT feature_usage_units_check
        CHECK (
          used_units >= 0
          AND reserved_units >= 0
        ),

      CONSTRAINT feature_usage_period_unique
        UNIQUE (
          family_id,
          feature_code,
          environment,
          quota_period,
          period_starts_at
        ),

      -- Permet de vérifier que chaque opération correspond
      -- bien à la famille, à la fonction et à l'environnement
      -- de son compteur.
      CONSTRAINT feature_usage_scope_unique
        UNIQUE (
          id,
          family_id,
          feature_code,
          environment
        )
    );


    CREATE TABLE feature_usage_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      usage_id uuid NOT NULL,

      family_id uuid NOT NULL,

      feature_code varchar(80) NOT NULL,

      environment varchar(20) NOT NULL,

      requested_by_user_id uuid NOT NULL
        REFERENCES users(id),

      -- Réutilisée si l'app renvoie la même demande.
      idempotency_key uuid NOT NULL,

      -- Empreinte du contenu de la demande.
      -- Empêche de réutiliser la même clé pour un autre contenu.
      request_hash text NOT NULL,

      units integer NOT NULL DEFAULT 1,

      status varchar(20) NOT NULL DEFAULT 'reserved',

      -- La limite applicable au moment de la réservation.
      quota_limit_at_reservation integer NOT NULL,

      reserved_at timestamptz NOT NULL DEFAULT NOW(),

      -- Date à partir de laquelle le serveur doit examiner
      -- une opération restée en cours.
      reconcile_after timestamptz NOT NULL,

      completed_at timestamptz,
      released_at timestamptz,

      release_reason text,

      -- Référence facultative vers le résultat sauvegardé.
      -- Aucun texte médical ou contenu de dictée ici.
      result_reference text,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT feature_usage_operation_scope_fk
        FOREIGN KEY (
          usage_id,
          family_id,
          feature_code,
          environment
        )
        REFERENCES feature_usage (
          id,
          family_id,
          feature_code,
          environment
        ),

      CONSTRAINT feature_usage_operation_environment_check
        CHECK (
          environment IN ('sandbox', 'production')
        ),

      CONSTRAINT feature_usage_operation_status_check
        CHECK (
          status IN (
            'reserved',
            'completed',
            'released'
          )
        ),

      CONSTRAINT feature_usage_operation_units_check
        CHECK (units > 0),

      CONSTRAINT feature_usage_operation_limit_check
        CHECK (
          quota_limit_at_reservation >= units
        ),

      CONSTRAINT feature_usage_operation_hash_check
        CHECK (length(trim(request_hash)) > 0),

      CONSTRAINT feature_usage_operation_reconcile_check
        CHECK (reconcile_after > reserved_at),

      CONSTRAINT feature_usage_operation_state_check
        CHECK (
          (
            status = 'reserved'
            AND completed_at IS NULL
            AND released_at IS NULL
            AND release_reason IS NULL
          )
          OR
          (
            status = 'completed'
            AND completed_at IS NOT NULL
            AND released_at IS NULL
            AND release_reason IS NULL
          )
          OR
          (
            status = 'released'
            AND completed_at IS NULL
            AND released_at IS NOT NULL
            AND release_reason IS NOT NULL
          )
        ),

      CONSTRAINT feature_usage_operation_completion_date_check
        CHECK (
          completed_at IS NULL
          OR completed_at >= reserved_at
        ),

      CONSTRAINT feature_usage_operation_release_date_check
        CHECK (
          released_at IS NULL
          OR released_at >= reserved_at
        ),

      -- L'unicité ne dépend pas de la journée :
      -- une relance après minuit reste la même opération.
      CONSTRAINT feature_usage_operation_idempotency_unique
        UNIQUE (
          family_id,
          feature_code,
          environment,
          idempotency_key
        )
    );


    CREATE INDEX feature_usage_operations_usage_idx
      ON feature_usage_operations (usage_id);

    CREATE INDEX feature_usage_operations_user_idx
      ON feature_usage_operations (requested_by_user_id);

    CREATE INDEX feature_usage_operations_reconcile_idx
      ON feature_usage_operations (reconcile_after)
      WHERE status = 'reserved';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE feature_usage_operations;
    DROP TABLE feature_usage;
  `);
};
