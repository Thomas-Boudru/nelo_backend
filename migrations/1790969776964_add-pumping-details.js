exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE pumping_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      left_amount_ml NUMERIC(8,3) NOT NULL DEFAULT 0,
      right_amount_ml NUMERIC(8,3) NOT NULL DEFAULT 0,

      CONSTRAINT pumping_details_left_amount_check
        CHECK (
          left_amount_ml >= 0
          AND left_amount_ml <> 'NaN'::numeric
        ),

      CONSTRAINT pumping_details_right_amount_check
        CHECK (
          right_amount_ml >= 0
          AND right_amount_ml <> 'NaN'::numeric
        ),

      CONSTRAINT pumping_details_total_amount_check
        CHECK (left_amount_ml + right_amount_ml > 0)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE pumping_details;
  `);
};
