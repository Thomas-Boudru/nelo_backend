exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE mood_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      mood_type VARCHAR(20) NOT NULL,

      CONSTRAINT mood_details_type_check
        CHECK (
          mood_type IN (
            'happy',
            'calm',
            'fussy',
            'crying',
            'unwell'
          )
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE mood_details;
  `);
};
