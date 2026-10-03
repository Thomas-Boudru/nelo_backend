exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE toileting_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      toileting_method VARCHAR(20) NOT NULL,
      result VARCHAR(20) NOT NULL,
      consistency VARCHAR(20),
      is_accident BOOLEAN NOT NULL DEFAULT false,

      CONSTRAINT toileting_details_method_check
        CHECK (toileting_method IN ('diaper', 'potty')),

      CONSTRAINT toileting_details_result_check
        CHECK (
          (
            toileting_method = 'diaper'
            AND result IN ('dry', 'wet', 'dirty', 'wetAndDirty')
          )
          OR
          (
            toileting_method = 'potty'
            AND result IN ('pee', 'poop', 'peeAndPoop')
          )
        ),

      CONSTRAINT toileting_details_consistency_check
        CHECK (
          consistency IS NULL
          OR consistency IN ('liquid', 'soft', 'formed', 'hard')
        ),

      CONSTRAINT toileting_details_consistency_result_check
        CHECK (
          consistency IS NULL
          OR (
            toileting_method = 'diaper'
            AND result IN ('dirty', 'wetAndDirty')
          )
        ),

      CONSTRAINT toileting_details_accident_check
        CHECK (
          toileting_method = 'potty'
          OR is_accident = false
        )
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE toileting_details;
  `);
};
