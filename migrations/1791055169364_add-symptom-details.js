exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE symptom_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      symptom_codes TEXT[] NOT NULL,

      CONSTRAINT symptom_details_codes_check
        CHECK (
          cardinality(symptom_codes) BETWEEN 1 AND 12
          AND array_ndims(symptom_codes) = 1
          AND array_position(symptom_codes, NULL) IS NULL
          AND symptom_codes <@ ARRAY[
            'irritability',
            'skinRash',
            'runnyNose',
            'cough',
            'fever',
            'unusualBreathing',
            'lowEnergy',
            'lackOfAppetite',
            'regurgitation',
            'vomiting',
            'diarrhea',
            'constipation'
          ]::TEXT[]
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE symptom_details;
  `);
};
