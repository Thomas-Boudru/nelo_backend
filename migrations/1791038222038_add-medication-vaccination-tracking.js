exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE child_custom_medications (
      id UUID PRIMARY KEY,
      child_id UUID NOT NULL REFERENCES children(id),

      name VARCHAR(150) NOT NULL,
      normalized_name VARCHAR(150) NOT NULL,
      default_dose_unit VARCHAR(30),

      created_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT custom_medications_name_check
        CHECK (
          length(trim(name)) > 0
          AND length(trim(normalized_name)) > 0
        ),

      CONSTRAINT custom_medications_unit_check
        CHECK (
          default_dose_unit IS NULL
          OR default_dose_unit IN (
            'ml', 'drops', 'tablet', 'suppository', 'dose'
          )
        ),

      CONSTRAINT custom_medications_version_check
        CHECK (version > 0)
    );

    CREATE UNIQUE INDEX idx_custom_medications_active_name
      ON child_custom_medications(child_id, normalized_name)
      WHERE archived_at IS NULL;

    CREATE INDEX idx_custom_medications_child_updated
      ON child_custom_medications(child_id, updated_at, id);


    CREATE TABLE child_custom_vaccines (
      id UUID PRIMARY KEY,
      child_id UUID NOT NULL REFERENCES children(id),

      name VARCHAR(150) NOT NULL,
      normalized_name VARCHAR(150) NOT NULL,

      created_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT custom_vaccines_name_check
        CHECK (
          length(trim(name)) > 0
          AND length(trim(normalized_name)) > 0
        ),

      CONSTRAINT custom_vaccines_version_check
        CHECK (version > 0)
    );

    CREATE UNIQUE INDEX idx_custom_vaccines_active_name
      ON child_custom_vaccines(child_id, normalized_name)
      WHERE archived_at IS NULL;

    CREATE INDEX idx_custom_vaccines_child_updated
      ON child_custom_vaccines(child_id, updated_at, id);


    CREATE TABLE medication_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      catalog_medication_code VARCHAR(100),
      custom_medication_id UUID
        REFERENCES child_custom_medications(id),

      medication_name_snapshot VARCHAR(150) NOT NULL,
      amount_value NUMERIC(10,3) NOT NULL,
      amount_unit VARCHAR(30) NOT NULL,

      CONSTRAINT medication_details_reference_check
        CHECK (
          (catalog_medication_code IS NOT NULL)
          <> (custom_medication_id IS NOT NULL)
        ),

      CONSTRAINT medication_details_code_check
        CHECK (
          catalog_medication_code IS NULL
          OR length(trim(catalog_medication_code)) > 0
        ),

      CONSTRAINT medication_details_name_check
        CHECK (length(trim(medication_name_snapshot)) > 0),

      CONSTRAINT medication_details_amount_check
        CHECK (
          amount_value > 0
          AND amount_value <> 'NaN'::numeric
        ),

      CONSTRAINT medication_details_unit_check
        CHECK (
          amount_unit IN (
            'ml', 'drops', 'tablet', 'suppository', 'dose'
          )
        )
    );


    CREATE TABLE vaccination_details (
      tracking_entry_id UUID PRIMARY KEY
        REFERENCES tracking_entries(id) ON DELETE CASCADE,

      catalog_vaccine_code VARCHAR(100),
      custom_vaccine_id UUID
        REFERENCES child_custom_vaccines(id),

      vaccine_name_snapshot VARCHAR(150) NOT NULL,

      dose_kind VARCHAR(20) NOT NULL DEFAULT 'unspecified',
      dose_number SMALLINT,

      CONSTRAINT vaccination_details_reference_check
        CHECK (
          (catalog_vaccine_code IS NOT NULL)
          <> (custom_vaccine_id IS NOT NULL)
        ),

      CONSTRAINT vaccination_details_code_check
        CHECK (
          catalog_vaccine_code IS NULL
          OR length(trim(catalog_vaccine_code)) > 0
        ),

      CONSTRAINT vaccination_details_name_check
        CHECK (length(trim(vaccine_name_snapshot)) > 0),

      CONSTRAINT vaccination_details_dose_check
        CHECK (
          (
            dose_kind = 'numbered'
            AND dose_number IS NOT NULL
            AND dose_number > 0
          )
          OR (
            dose_kind IN ('booster', 'unspecified')
            AND dose_number IS NULL
          )
        )
    );


    CREATE TABLE vaccination_reminders (
      id UUID PRIMARY KEY,
      child_id UUID NOT NULL REFERENCES children(id),

      source_tracking_entry_id UUID NOT NULL UNIQUE
        REFERENCES tracking_entries(id),

      catalog_vaccine_code VARCHAR(100),
      custom_vaccine_id UUID
        REFERENCES child_custom_vaccines(id),

      vaccine_name_snapshot VARCHAR(150) NOT NULL,
      due_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',

      completed_by_tracking_entry_id UUID
        REFERENCES tracking_entries(id),

      created_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL,

      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version INTEGER NOT NULL DEFAULT 1,

      CONSTRAINT vaccination_reminders_reference_check
        CHECK (
          (catalog_vaccine_code IS NOT NULL)
          <> (custom_vaccine_id IS NOT NULL)
        ),

      CONSTRAINT vaccination_reminders_code_check
        CHECK (
          catalog_vaccine_code IS NULL
          OR length(trim(catalog_vaccine_code)) > 0
        ),

      CONSTRAINT vaccination_reminders_name_check
        CHECK (length(trim(vaccine_name_snapshot)) > 0),

      CONSTRAINT vaccination_reminders_status_check
        CHECK (status IN ('pending', 'completed', 'cancelled')),

      CONSTRAINT vaccination_reminders_state_check
        CHECK (
          (
            status = 'pending'
            AND completed_at IS NULL
            AND cancelled_at IS NULL
            AND completed_by_tracking_entry_id IS NULL
          )
          OR (
            status = 'completed'
            AND completed_at IS NOT NULL
            AND cancelled_at IS NULL
            AND completed_by_tracking_entry_id IS NOT NULL
          )
          OR (
            status = 'cancelled'
            AND cancelled_at IS NOT NULL
            AND completed_at IS NULL
            AND completed_by_tracking_entry_id IS NULL
          )
        ),

      CONSTRAINT vaccination_reminders_version_check
        CHECK (version > 0)
    );

    CREATE INDEX idx_vaccination_reminders_child_due
      ON vaccination_reminders(child_id, due_date, id)
      WHERE status = 'pending';

    CREATE INDEX idx_vaccination_reminders_child_updated
      ON vaccination_reminders(child_id, updated_at, id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE vaccination_reminders;
    DROP TABLE vaccination_details;
    DROP TABLE medication_details;
    DROP TABLE child_custom_vaccines;
    DROP TABLE child_custom_medications;
  `);
};
