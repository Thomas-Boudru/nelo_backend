exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE temperature_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      temperature_celsius NUMERIC(4,2) NOT NULL,

      measurement_site VARCHAR(30) NOT NULL,

      input_value NUMERIC(5,2),

      input_unit VARCHAR(20),

      CONSTRAINT temperature_details_celsius_check
        CHECK (temperature_celsius BETWEEN 34 AND 42),

      CONSTRAINT temperature_details_site_check
        CHECK (
          measurement_site IN ('forehead', 'armpit', 'rectal', 'ear')
        ),

      CONSTRAINT temperature_details_input_check
        CHECK (
          (input_value IS NULL AND input_unit IS NULL)
          OR
          (
            input_value IS NOT NULL
            AND input_unit IS NOT NULL
            AND (
              (input_unit = 'celsius' AND input_value BETWEEN 34 AND 42)
              OR
              (input_unit = 'fahrenheit' AND input_value BETWEEN 93.2 AND 107.6)
            )
          )
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE temperature_details;
  `);
};
