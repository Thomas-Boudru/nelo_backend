exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE nelo_conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      user_id uuid NOT NULL
        REFERENCES users(id),

      family_id uuid NOT NULL
        REFERENCES families(id),

      child_id uuid NOT NULL
        REFERENCES children(id),

      title varchar(200),

      status varchar(20) NOT NULL DEFAULT 'active',

      -- Résumé des anciens échanges uniquement.
      summary text,

      -- Dernier message inclus dans le résumé.
      summary_through_message_sequence bigint,

      summary_updated_at timestamptz,

      summary_version integer NOT NULL DEFAULT 0,

      -- Prochain numéro disponible dans cette conversation.
      -- Sera incrémenté sous verrou par le service.
      next_message_sequence bigint NOT NULL DEFAULT 1,

      last_message_at timestamptz,

      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),

      deleted_at timestamptz,

      CONSTRAINT nelo_conversation_status_check
        CHECK (
          status IN ('active', 'archived')
        ),

      CONSTRAINT nelo_conversation_title_check
        CHECK (
          title IS NULL
          OR length(trim(title)) > 0
        ),

      CONSTRAINT nelo_conversation_sequence_check
        CHECK (
          next_message_sequence >= 1
        ),

      CONSTRAINT nelo_conversation_summary_version_check
        CHECK (
          summary_version >= 0
        ),

      CONSTRAINT nelo_conversation_summary_check
        CHECK (
          (
            summary IS NULL
            AND summary_through_message_sequence IS NULL
            AND summary_updated_at IS NULL
            AND summary_version = 0
          )
          OR
          (
            summary IS NOT NULL
            AND length(trim(summary)) > 0
            AND summary_through_message_sequence IS NOT NULL
            AND summary_through_message_sequence >= 1
            AND summary_through_message_sequence
              < next_message_sequence
            AND summary_updated_at IS NOT NULL
            AND summary_version >= 1
          )
        )
    );

    CREATE INDEX nelo_conversations_user_child_idx
      ON nelo_conversations (
        user_id,
        child_id,
        last_message_at DESC NULLS LAST,
        id
      )
      WHERE deleted_at IS NULL;

    CREATE INDEX nelo_conversations_family_idx
      ON nelo_conversations (family_id);

    CREATE INDEX nelo_conversations_child_idx
      ON nelo_conversations (child_id);


    CREATE TABLE nelo_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      conversation_id uuid NOT NULL
        REFERENCES nelo_conversations(id)
        ON DELETE CASCADE,

      sequence_number bigint NOT NULL,

      role varchar(20) NOT NULL,

      -- UUID créé par le frontend pour un message utilisateur.
      -- Conservé à l'identique lors d'une nouvelle tentative.
      client_message_id uuid,

      content text NOT NULL,

      input_mode varchar(20),

      -- Suggestions de questions et sources réellement utilisées.
      suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
      sources jsonb NOT NULL DEFAULT '[]'::jsonb,

      created_at timestamptz NOT NULL DEFAULT NOW(),

      CONSTRAINT nelo_message_sequence_check
        CHECK (
          sequence_number >= 1
        ),

      CONSTRAINT nelo_message_role_check
        CHECK (
          role IN ('user', 'assistant')
        ),

      CONSTRAINT nelo_message_content_check
        CHECK (
          length(trim(content)) > 0
        ),

      CONSTRAINT nelo_message_input_check
        CHECK (
          (
            role = 'user'
            AND client_message_id IS NOT NULL
            AND input_mode IS NOT NULL
            AND input_mode IN ('text', 'voice', 'suggestion')
          )
          OR
          (
            role = 'assistant'
            AND client_message_id IS NULL
            AND input_mode IS NULL
          )
        ),

      CONSTRAINT nelo_message_suggestions_check
        CHECK (
          jsonb_typeof(suggestions) = 'array'
        ),

      CONSTRAINT nelo_message_sources_check
        CHECK (
          jsonb_typeof(sources) = 'array'
        ),

      CONSTRAINT nelo_message_user_metadata_check
        CHECK (
          role <> 'user'
          OR (
            suggestions = '[]'::jsonb
            AND sources = '[]'::jsonb
          )
        ),

      CONSTRAINT nelo_message_sequence_unique
        UNIQUE (
          conversation_id,
          sequence_number
        ),

      CONSTRAINT nelo_message_client_identity_unique
        UNIQUE (
          conversation_id,
          client_message_id
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE nelo_messages;
    DROP TABLE nelo_conversations;
  `);
};
