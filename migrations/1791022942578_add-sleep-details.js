exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sleep_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      sleep_type VARCHAR(20) NOT NULL,

      ended_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      CONSTRAINT sleep_details_type_check
        CHECK (sleep_type IN ('nap', 'night'))
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE sleep_details;
  `);
};
