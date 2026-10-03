exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE teething_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      tooth_codes TEXT[] NOT NULL,

      eruption_date DATE NOT NULL,

      CONSTRAINT teething_details_codes_check
        CHECK (
          cardinality(tooth_codes) BETWEEN 1 AND 20
          AND array_ndims(tooth_codes) = 1
          AND array_position(tooth_codes, NULL) IS NULL
          AND tooth_codes <@ ARRAY[
            'upper_left_central_incisor',
            'upper_left_lateral_incisor',
            'upper_left_canine',
            'upper_left_first_molar',
            'upper_left_second_molar',

            'upper_right_central_incisor',
            'upper_right_lateral_incisor',
            'upper_right_canine',
            'upper_right_first_molar',
            'upper_right_second_molar',

            'lower_left_central_incisor',
            'lower_left_lateral_incisor',
            'lower_left_canine',
            'lower_left_first_molar',
            'lower_left_second_molar',

            'lower_right_central_incisor',
            'lower_right_lateral_incisor',
            'lower_right_canine',
            'lower_right_first_molar',
            'lower_right_second_molar'
          ]::TEXT[]
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE teething_details;
  `);
};
