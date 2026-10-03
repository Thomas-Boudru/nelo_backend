exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX idx_tracking_entries_one_active_sleep
      ON tracking_entries(child_id)
      WHERE entry_type = 'sleep'
        AND ended_at IS NULL
        AND deleted_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX idx_tracking_entries_one_active_sleep;
  `);
};
