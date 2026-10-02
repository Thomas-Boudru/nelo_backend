exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE child_custom_foods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      child_id UUID NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,

      name VARCHAR(150) NOT NULL,
      normalized_name TEXT NOT NULL,

      emoji VARCHAR(32) NOT NULL DEFAULT '🥣',
      suggested_unit VARCHAR(20) NOT NULL DEFAULT 'piece',

      created_by_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE RESTRICT,

      version INTEGER NOT NULL DEFAULT 1,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,

      CONSTRAINT child_custom_foods_name_check
        CHECK (length(btrim(name)) > 0),

      CONSTRAINT child_custom_foods_normalized_name_check
        CHECK (length(btrim(normalized_name)) > 0),

      CONSTRAINT child_custom_foods_suggested_unit_check
        CHECK (
          suggested_unit IN (
            'piece',
            'g',
            'ml',
            'teaspoon',
            'tablespoon',
            'portion'
          )
        ),

      CONSTRAINT child_custom_foods_version_check
        CHECK (version >= 1),

      UNIQUE (id, child_id)
    );

    CREATE UNIQUE INDEX child_custom_foods_active_name_idx
      ON child_custom_foods (child_id, normalized_name)
      WHERE deleted_at IS NULL;

    CREATE INDEX child_custom_foods_sync_idx
      ON child_custom_foods (child_id, updated_at, id);


    CREATE TABLE solid_feeding_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      amount_eaten VARCHAR(20),
      reaction VARCHAR(20),

      CONSTRAINT solid_feeding_details_amount_eaten_check
        CHECK (
          amount_eaten IS NULL
          OR amount_eaten IN (
            'tasted',
            'little',
            'half',
            'almost_all',
            'all'
          )
        ),

      CONSTRAINT solid_feeding_details_reaction_check
        CHECK (
          reaction IS NULL
          OR reaction IN (
            'liked',
            'neutral',
            'disliked'
          )
        )
    );


    CREATE TABLE solid_feeding_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      tracking_entry_id UUID NOT NULL
        REFERENCES solid_feeding_details(tracking_entry_id)
        ON DELETE CASCADE,

      child_id UUID NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,

      standard_food_id VARCHAR(100),

      custom_food_id UUID,

      food_name_snapshot VARCHAR(150) NOT NULL,

      quantity_value NUMERIC(12,3),
      quantity_unit VARCHAR(20),

      sort_order INTEGER NOT NULL,

      CONSTRAINT solid_feeding_items_custom_food_fk
        FOREIGN KEY (custom_food_id, child_id)
        REFERENCES child_custom_foods(id, child_id)
        ON DELETE RESTRICT,

      CONSTRAINT solid_feeding_items_food_reference_check
        CHECK (
          (standard_food_id IS NOT NULL AND custom_food_id IS NULL)
          OR
          (standard_food_id IS NULL AND custom_food_id IS NOT NULL)
        ),

      CONSTRAINT solid_feeding_items_standard_food_id_check
        CHECK (
          standard_food_id IS NULL
          OR length(btrim(standard_food_id)) > 0
        ),

      CONSTRAINT solid_feeding_items_name_snapshot_check
        CHECK (length(btrim(food_name_snapshot)) > 0),

      CONSTRAINT solid_feeding_items_quantity_check
        CHECK (
          (
            quantity_value IS NULL
            AND quantity_unit IS NULL
          )
          OR
          (
            quantity_value IS NOT NULL
            AND quantity_unit IS NOT NULL
            AND quantity_value > 0
            AND quantity_value <> 'NaN'::numeric
            AND quantity_unit IN (
              'piece',
              'g',
              'ml',
              'teaspoon',
              'tablespoon',
              'portion'
            )
          )
        ),

      CONSTRAINT solid_feeding_items_sort_order_check
        CHECK (sort_order >= 0),

      UNIQUE (tracking_entry_id, sort_order)
    );


    CREATE TABLE tracking_entry_attachments (
      tracking_entry_id UUID NOT NULL
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      attachment_id UUID NOT NULL
        REFERENCES attachments(id) ON DELETE RESTRICT,

      sort_order INTEGER NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (tracking_entry_id, attachment_id),

      CONSTRAINT tracking_entry_attachments_sort_order_check
        CHECK (sort_order >= 0),

      UNIQUE (attachment_id),
      UNIQUE (tracking_entry_id, sort_order)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE tracking_entry_attachments;
    DROP TABLE solid_feeding_items;
    DROP TABLE solid_feeding_details;
    DROP TABLE child_custom_foods;
  `);
};
