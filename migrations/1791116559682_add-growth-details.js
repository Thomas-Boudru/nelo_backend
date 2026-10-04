exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE growth_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      measurement_date DATE NOT NULL,

      weight_g NUMERIC(12, 3),
      height_mm NUMERIC(10, 3),
      head_circumference_mm NUMERIC(10, 3),

      CONSTRAINT growth_details_has_measurement_check
        CHECK (
          weight_g IS NOT NULL
          OR height_mm IS NOT NULL
          OR head_circumference_mm IS NOT NULL
        ),

      CONSTRAINT growth_details_weight_check
        CHECK (
          weight_g IS NULL
          OR (
            weight_g > 0
            AND weight_g < 'Infinity'::NUMERIC
            AND weight_g <> 'NaN'::NUMERIC
          )
        ),

      CONSTRAINT growth_details_height_check
        CHECK (
          height_mm IS NULL
          OR (
            height_mm > 0
            AND height_mm < 'Infinity'::NUMERIC
            AND height_mm <> 'NaN'::NUMERIC
          )
        ),

      CONSTRAINT growth_details_head_circumference_check
        CHECK (
          head_circumference_mm IS NULL
          OR (
            head_circumference_mm > 0
            AND head_circumference_mm < 'Infinity'::NUMERIC
            AND head_circumference_mm <> 'NaN'::NUMERIC
          )
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE growth_details;
  `);
};
