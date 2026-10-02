exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE breastfeeding_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      left_duration_seconds INTEGER NOT NULL DEFAULT 0,
      right_duration_seconds INTEGER NOT NULL DEFAULT 0,

      first_side VARCHAR(10),
      last_side VARCHAR(10),

      CONSTRAINT breastfeeding_details_left_duration_check
        CHECK (left_duration_seconds >= 0),

      CONSTRAINT breastfeeding_details_right_duration_check
        CHECK (right_duration_seconds >= 0),

      CONSTRAINT breastfeeding_details_total_duration_check
        CHECK (
          left_duration_seconds > 0
          OR right_duration_seconds > 0
        ),

      CONSTRAINT breastfeeding_details_first_side_check
        CHECK (
          first_side IS NULL
          OR first_side IN ('left', 'right')
        ),

      CONSTRAINT breastfeeding_details_last_side_check
        CHECK (
          last_side IS NULL
          OR last_side IN ('left', 'right')
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE breastfeeding_details;
  `);
};
