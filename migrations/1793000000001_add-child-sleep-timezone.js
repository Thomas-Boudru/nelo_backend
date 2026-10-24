exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE children
    ADD COLUMN sleep_timezone VARCHAR(100);

    COMMENT ON COLUMN children.sleep_timezone IS
      'IANA timezone used for sleep prediction, such as Europe/Brussels.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE children
    DROP COLUMN sleep_timezone;
  `);
};
