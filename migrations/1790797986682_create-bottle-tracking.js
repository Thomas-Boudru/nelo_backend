exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE tracking_entries (
      id UUID PRIMARY KEY,
      child_id UUID NOT NULL REFERENCES children(id),
      entry_type VARCHAR(30) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      note_text TEXT,
      source VARCHAR(20) NOT NULL DEFAULT 'manual',

      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT tracking_entries_source_check
        CHECK (source IN ('manual', 'timer', 'nelo', 'import')),

      CONSTRAINT tracking_entries_dates_check
        CHECK (ended_at IS NULL OR ended_at >= started_at),

      CONSTRAINT tracking_entries_version_check
        CHECK (version > 0),

      CONSTRAINT tracking_entries_type_check
        CHECK (length(trim(entry_type)) > 0)
    );

    CREATE INDEX idx_tracking_entries_child_date
      ON tracking_entries(child_id, started_at DESC, id DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_tracking_entries_child_type_date
      ON tracking_entries(child_id, entry_type, started_at DESC, id DESC)
      WHERE deleted_at IS NULL;

    -- Inclut les suppressions logiques pour la synchronisation.
    CREATE INDEX idx_tracking_entries_child_updated
      ON tracking_entries(child_id, updated_at, id);

    CREATE TABLE bottle_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      amount_ml NUMERIC(8,3) NOT NULL,
      bottle_capacity_ml NUMERIC(8,3) NOT NULL,
      content_type VARCHAR(30) NOT NULL,

      child_formula_id UUID,
      formula_name_snapshot VARCHAR(150),

      CONSTRAINT bottle_details_amount_check
        CHECK (
          amount_ml > 0
          AND amount_ml <> 'NaN'::numeric
        ),

      CONSTRAINT bottle_details_capacity_check
        CHECK (
          bottle_capacity_ml > 0
          AND bottle_capacity_ml <> 'NaN'::numeric
        ),

      CONSTRAINT bottle_details_content_type_check
        CHECK (
          content_type IN (
            'formula',
            'breast_milk',
            'mixed',
            'other'
          )
        )
    );

    CREATE TABLE child_bottle_presets (
      id UUID PRIMARY KEY,
      child_id UUID NOT NULL REFERENCES children(id),

      label VARCHAR(80),
      capacity_ml NUMERIC(8,3) NOT NULL,
      original_value NUMERIC(8,3) NOT NULL,
      original_unit VARCHAR(20) NOT NULL DEFAULT 'ml',

      created_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT child_bottle_presets_capacity_check
        CHECK (
          capacity_ml > 0
          AND capacity_ml <> 'NaN'::numeric
        ),

      CONSTRAINT child_bottle_presets_original_value_check
        CHECK (
          original_value > 0
          AND original_value <> 'NaN'::numeric
        ),

      CONSTRAINT child_bottle_presets_unit_check
        CHECK (original_unit IN ('ml', 'fl_oz')),

      CONSTRAINT child_bottle_presets_label_check
        CHECK (label IS NULL OR length(trim(label)) > 0),

      CONSTRAINT child_bottle_presets_version_check
        CHECK (version > 0)
    );

    -- Une même capacité ne peut être ajoutée deux fois
    -- pour un bébé parmi les presets actifs.
    CREATE UNIQUE INDEX idx_child_bottle_presets_unique_capacity
      ON child_bottle_presets(child_id, capacity_ml)
      WHERE archived_at IS NULL;

    -- Inclut les presets archivés pour la synchronisation.
    CREATE INDEX idx_child_bottle_presets_child_updated
      ON child_bottle_presets(child_id, updated_at, id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE child_bottle_presets;
    DROP TABLE bottle_details;
    DROP TABLE tracking_entries;
  `);
};
