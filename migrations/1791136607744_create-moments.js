exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE moments (
      id UUID PRIMARY KEY,

      child_id UUID NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,

      moment_type VARCHAR(20) NOT NULL,

      title VARCHAR(150),
      story VARCHAR(600),

      occurred_on DATE NOT NULL,
      timezone_at_event VARCHAR(64),

      status VARCHAR(20) NOT NULL DEFAULT 'draft',

      created_by_user_id UUID NOT NULL
        REFERENCES users(id),

      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      deleted_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,

      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT moments_type_check
        CHECK (moment_type IN ('photo', 'note', 'milestone')),

      CONSTRAINT moments_status_check
        CHECK (status IN ('draft', 'published')),

      CONSTRAINT moments_version_check
        CHECK (version >= 1),

      CONSTRAINT moments_title_check
        CHECK (
          title IS NULL
          OR title ~ '[^[:space:]]'
        ),

      CONSTRAINT moments_published_note_content_check
        CHECK (
          status <> 'published'
          OR moment_type <> 'note'
          OR (
            story IS NOT NULL
            AND story ~ '[^[:space:]]'
          )
        )
    );

    CREATE INDEX idx_moments_child_published_date
      ON moments (
        child_id,
        occurred_on DESC,
        id DESC
      )
      WHERE deleted_at IS NULL
        AND status = 'published';

    CREATE INDEX idx_moments_child_type_date
      ON moments (
        child_id,
        moment_type,
        occurred_on DESC,
        id DESC
      )
      WHERE deleted_at IS NULL
        AND status = 'published';

    CREATE INDEX idx_moments_child_author_date
      ON moments (
        child_id,
        created_by_user_id,
        occurred_on DESC,
        id DESC
      )
      WHERE deleted_at IS NULL
        AND status = 'published';

    CREATE INDEX idx_moments_child_updated
      ON moments (
        child_id,
        updated_at,
        id
      );


    CREATE TABLE moment_attachments (
      moment_id UUID NOT NULL
        REFERENCES moments(id) ON DELETE CASCADE,

      attachment_id UUID NOT NULL
        REFERENCES attachments(id),

      display_order SMALLINT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (moment_id, attachment_id),

      CONSTRAINT moment_attachments_attachment_unique
        UNIQUE (attachment_id),

      CONSTRAINT moment_attachments_order_unique
        UNIQUE (moment_id, display_order)
        DEFERRABLE INITIALLY IMMEDIATE,

      CONSTRAINT moment_attachments_order_check
        CHECK (display_order >= 0)
    );


    CREATE TABLE child_custom_milestones (
      id UUID PRIMARY KEY,

      child_id UUID NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,

      name VARCHAR(150) NOT NULL,
      normalized_name VARCHAR(150) NOT NULL,

      category_code VARCHAR(32) NOT NULL,

      created_by_user_id UUID NOT NULL
        REFERENCES users(id),

      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ,

      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT child_custom_milestones_name_check
        CHECK (name ~ '[^[:space:]]'),

      CONSTRAINT child_custom_milestones_normalized_name_check
        CHECK (normalized_name ~ '[^[:space:]]'),

      CONSTRAINT child_custom_milestones_category_check
        CHECK (
          category_code IN (
            'development',
            'feeding',
            'sleep',
            'growth',
            'daily-life'
          )
        ),

      CONSTRAINT child_custom_milestones_version_check
        CHECK (version >= 1)
    );

    CREATE UNIQUE INDEX idx_custom_milestones_active_name
      ON child_custom_milestones (
        child_id,
        category_code,
        normalized_name
      )
      WHERE archived_at IS NULL;

    CREATE INDEX idx_custom_milestones_child_updated
      ON child_custom_milestones (
        child_id,
        updated_at,
        id
      );


    CREATE TABLE milestone_details (
      moment_id UUID PRIMARY KEY
        REFERENCES moments(id) ON DELETE CASCADE,

      catalog_milestone_code VARCHAR(100),

      custom_milestone_id UUID
        REFERENCES child_custom_milestones(id),

      milestone_name_snapshot VARCHAR(150) NOT NULL,

      CONSTRAINT milestone_details_reference_check
        CHECK (
          (catalog_milestone_code IS NOT NULL)
          <>
          (custom_milestone_id IS NOT NULL)
        ),

      CONSTRAINT milestone_details_catalog_code_check
        CHECK (
          catalog_milestone_code IS NULL
          OR catalog_milestone_code ~ '[^[:space:]]'
        ),

      CONSTRAINT milestone_details_snapshot_check
        CHECK (milestone_name_snapshot ~ '[^[:space:]]')
    );

    CREATE INDEX idx_milestone_details_custom_milestone
      ON milestone_details (custom_milestone_id)
      WHERE custom_milestone_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE milestone_details;
    DROP TABLE moment_attachments;
    DROP TABLE child_custom_milestones;
    DROP TABLE moments;
  `);
};
