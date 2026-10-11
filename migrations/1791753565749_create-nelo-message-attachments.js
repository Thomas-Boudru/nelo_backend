exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE nelo_message_attachments (
      message_id uuid NOT NULL
        REFERENCES nelo_messages(id)
        ON DELETE CASCADE,

      attachment_id uuid NOT NULL
        REFERENCES attachments(id),

      display_order integer NOT NULL,

      created_at timestamptz NOT NULL DEFAULT NOW(),

      PRIMARY KEY (message_id, attachment_id),

      -- Un fichier envoyé dans le chat appartient à un seul message.
      CONSTRAINT nelo_message_attachments_attachment_unique
        UNIQUE (attachment_id),

      CONSTRAINT nelo_message_attachments_order_unique
        UNIQUE (message_id, display_order)
        DEFERRABLE INITIALLY IMMEDIATE,

      CONSTRAINT nelo_message_attachments_order_check
        CHECK (display_order >= 0)
    );

    INSERT INTO subscription_plan_features (
      plan_code,
      feature_code,
      access_level,
      quota_limit,
      quota_period
    )
    VALUES
      (
        'free',
        'assistant_attachments',
        'disabled',
        NULL,
        NULL
      ),
      (
        'premium',
        'assistant_attachments',
        'enabled',
        NULL,
        NULL
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM subscription_plan_features
    WHERE feature_code = 'assistant_attachments'
      AND plan_code IN ('free', 'premium');

    DROP TABLE nelo_message_attachments;
  `);
};
