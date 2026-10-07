const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const { VACCINE_CODES } = require("./vaccineCatalog");

const SELECT_VACCINATION = `
  SELECT
    t.*,
    v.catalog_vaccine_code,
    v.custom_vaccine_id,
    v.vaccine_name_snapshot,
    v.dose_kind,
    v.dose_number,

    r.id AS reminder_id,
    to_char(r.due_date, 'YYYY-MM-DD') AS next_dose_date,
    r.status AS reminder_status

  FROM tracking_entries t
  INNER JOIN vaccination_details v
    ON v.tracking_entry_id = t.id

  LEFT JOIN vaccination_reminders r
    ON r.source_tracking_entry_id = t.id
`;

function mapVaccination(row) {
  const startedAt = new Date(row.started_at).toISOString();

  const dose =
    row.dose_kind === "numbered"
      ? row.dose_number
      : row.dose_kind === "booster"
        ? "booster"
        : null;

  return {
    id: row.id,
    childId: row.child_id,
    type: "vaccine",

    vaccineId: row.custom_vaccine_id ?? row.catalog_vaccine_code,
    vaccineName: row.vaccine_name_snapshot,
    isCustomVaccine: row.custom_vaccine_id !== null,

    dose,
    nextDoseDate:
      row.reminder_status === "cancelled" ? null : (row.next_dose_date ?? null),
    reminderId: row.reminder_id ?? null,
    reminderStatus: row.reminder_status ?? null,

    startedAt,
    vaccineDate: startedAt,
    endedAt: row.ended_at,
    note: row.note_text ?? "",
    source: row.source,

    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedByUserId: row.deleted_by_user_id,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
  };
}

function validateNextDoseDate(value) {
  if (value == null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    throw createTrackingError(
      "INVALID_NEXT_DOSE_DATE",
      "The next dose date must use YYYY-MM-DD.",
      400,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createTrackingError(
      "INVALID_NEXT_DOSE_DATE",
      "Invalid next dose date.",
      400,
    );
  }

  // Une date peut être passée au moment de la synchronisation
  // si elle a été enregistrée hors ligne auparavant.
  return value;
}

function validateVaccinationData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_VACCINATION_ENTRY",
      "Invalid vaccination entry.",
      400,
    );
  }

  if (
    typeof data.vaccineId !== "string" ||
    typeof data.isCustomVaccine !== "boolean"
  ) {
    throw createTrackingError(
      "INVALID_VACCINE_REFERENCE",
      "A valid vaccine reference is required.",
      400,
    );
  }

  let vaccineId = data.vaccineId;

  if (data.isCustomVaccine) {
    validateUuid(vaccineId, "custom vaccine ID");
    vaccineId = vaccineId.toLowerCase();
  } else if (!VACCINE_CODES.has(vaccineId)) {
    throw createTrackingError(
      "INVALID_VACCINE_REFERENCE",
      "Unknown catalog vaccine.",
      400,
    );
  }

  if (
    typeof data.vaccineName !== "string" ||
    data.vaccineName.trim().length < 1 ||
    data.vaccineName.trim().length > 150
  ) {
    throw createTrackingError(
      "INVALID_VACCINE_NAME",
      "A vaccine name of up to 150 characters is required.",
      400,
    );
  }

  const dose = data.dose ?? null;

  let doseKind = "unspecified";
  let doseNumber = null;

  if (dose === "booster") {
    doseKind = "booster";
  } else if (dose !== null) {
    if (!Number.isInteger(dose) || dose < 1 || dose > 32767) {
      throw createTrackingError(
        "INVALID_VACCINE_DOSE",
        "Invalid vaccine dose number.",
        400,
      );
    }

    doseKind = "numbered";
    doseNumber = dose;
  }

  if (
    typeof data.vaccineDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.vaccineDate) ||
    !Number.isFinite(Date.parse(data.vaccineDate))
  ) {
    throw createTrackingError(
      "INVALID_VACCINATION_DATE",
      "A valid vaccination date with a timezone is required.",
      400,
    );
  }

  const vaccineDate = new Date(data.vaccineDate).toISOString();

  if (Date.parse(vaccineDate) > Date.now()) {
    throw createTrackingError(
      "INVALID_VACCINATION_DATE",
      "Vaccination time cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_VACCINATION_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    vaccineId,
    isCustomVaccine: data.isCustomVaccine,
    vaccineName: data.vaccineName.trim(),
    vaccineDate,
    doseKind,
    doseNumber,
    nextDoseDate: validateNextDoseDate(data.nextDoseDate),
    note: data.note?.trim() || null,
  };
}

async function readVaccination(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_VACCINATION}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'vaccine'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getVaccinationEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readVaccination(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapVaccination(row);
}

async function createVaccinationEntry({ childId, userId, data }) {
  const values = validateVaccinationData(data);
  const entryId = data.id ?? randomUUID();

  validateUuid(entryId, "tracking entry ID");

  const catalogCode = values.isCustomVaccine ? null : values.vaccineId;
  const customId = values.isCustomVaccine ? values.vaccineId : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const inserted = await client.query(
      `
        INSERT INTO tracking_entries (
          id,
          child_id,
          entry_type,
          started_at,
          note_text,
          source,
          created_by_user_id
        )
        VALUES ($1, $2, 'vaccine', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.vaccineDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readVaccination(client, childId, entryId);

      const sameData =
        existing &&
        existing.created_by_user_id === userId.toLowerCase() &&
        existing.source === "manual" &&
        new Date(existing.started_at).toISOString() === values.vaccineDate &&
        (existing.note_text ?? null) === values.note &&
        existing.catalog_vaccine_code === catalogCode &&
        existing.custom_vaccine_id === customId &&
        existing.vaccine_name_snapshot === values.vaccineName &&
        existing.dose_kind === values.doseKind &&
        existing.dose_number === values.doseNumber &&
        (existing.next_dose_date ?? null) === values.nextDoseDate;

      if (!sameData) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used or has different data.",
          409,
        );
      }

      await client.query("COMMIT");

      return {
        created: false,
        entry: mapVaccination(existing),
      };
    }

    if (values.isCustomVaccine) {
      const product = await client.query(
        `
          SELECT id
          FROM child_custom_vaccines
          WHERE id = $1
            AND child_id = $2
            AND archived_at IS NULL
          FOR SHARE
        `,
        [values.vaccineId, childId],
      );

      if (product.rowCount === 0) {
        throw createTrackingError(
          "CUSTOM_VACCINE_UNAVAILABLE",
          "This custom vaccine is unavailable for this child.",
          409,
        );
      }
    }

    await client.query(
      `
        INSERT INTO vaccination_details (
          tracking_entry_id,
          catalog_vaccine_code,
          custom_vaccine_id,
          vaccine_name_snapshot,
          dose_kind,
          dose_number
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        entryId,
        catalogCode,
        customId,
        values.vaccineName,
        values.doseKind,
        values.doseNumber,
      ],
    );

    if (values.nextDoseDate !== null) {
      await client.query(
        `
          INSERT INTO vaccination_reminders (
            id,
            child_id,
            source_tracking_entry_id,
            catalog_vaccine_code,
            custom_vaccine_id,
            vaccine_name_snapshot,
            due_date,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
        `,
        [
          randomUUID(),
          childId,
          entryId,
          catalogCode,
          customId,
          values.vaccineName,
          values.nextDoseDate,
          userId,
        ],
      );
    }

    const row = await readVaccination(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapVaccination(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getVaccinationReminders({ childId, userId }) {
  await requireChildTrackingAccess({ childId, userId });

  const result = await pool.query(
    `
      SELECT
        r.*,
        to_char(r.due_date, 'YYYY-MM-DD') AS due_date_string,
        t.deleted_at AS source_deleted_at
      FROM vaccination_reminders r
      INNER JOIN tracking_entries t
        ON t.id = r.source_tracking_entry_id
        AND t.child_id = r.child_id
        AND t.entry_type = 'vaccine'
      WHERE r.child_id = $1
      ORDER BY r.due_date ASC, r.id ASC
    `,
    [childId],
  );

  // Inclure tous les états permet au cache SQLite de retirer
  // également les rappels terminés, annulés ou devenus invisibles.
  return result.rows.map((row) => ({
    id: row.id,
    childId: row.child_id,
    sourceTrackingEntryId: row.source_tracking_entry_id,
    vaccineId: row.custom_vaccine_id ?? row.catalog_vaccine_code,
    vaccineName: row.vaccine_name_snapshot,
    isCustomVaccine: row.custom_vaccine_id !== null,
    dueDate: row.due_date_string,
    status: row.status,
    sourceDeletedAt: row.source_deleted_at,
    completedByTrackingEntryId: row.completed_by_tracking_entry_id,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }));
}

async function readVaccinationReminder(database, childId, entryId) {
  const result = await database.query(
    `
      SELECT
        r.*,
        to_char(r.due_date, 'YYYY-MM-DD') AS due_date_string
      FROM vaccination_reminders r
      WHERE r.child_id = $1
        AND r.source_tracking_entry_id = $2
    `,
    [childId, entryId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    childId: row.child_id,
    sourceTrackingEntryId: row.source_tracking_entry_id,
    vaccineId: row.custom_vaccine_id ?? row.catalog_vaccine_code,
    vaccineName: row.vaccine_name_snapshot,
    isCustomVaccine: row.custom_vaccine_id !== null,
    dueDate: row.due_date_string,
    status: row.status,
    sourceDeletedAt: null,
    completedByTrackingEntryId: row.completed_by_tracking_entry_id,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

async function updateVaccinationEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateVaccinationData(data);

  if (!Number.isSafeInteger(data.version) || data.version < 1) {
    throw createTrackingError(
      "INVALID_TRACKING_VERSION",
      "A valid tracking version is required.",
      400,
    );
  }

  const catalogCode = values.isCustomVaccine ? null : values.vaccineId;
  const customId = values.isCustomVaccine ? values.vaccineId : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const locked = await client.query(
      `
        SELECT id
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'vaccine'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [entryId, childId],
    );

    if (locked.rowCount === 0) {
      throw createTrackingError(
        "TRACKING_ENTRY_NOT_FOUND",
        "Tracking entry not found.",
        404,
      );
    }

    await client.query(
      `
        SELECT id
        FROM vaccination_reminders
        WHERE source_tracking_entry_id = $1
          AND child_id = $2
        FOR UPDATE
      `,
      [entryId, childId],
    );

    const current = await readVaccination(client, childId, entryId);

    if (!current) {
      throw createTrackingError(
        "VACCINATION_DETAILS_MISSING",
        "Vaccination details are missing.",
        500,
      );
    }

    const currentNextDoseDate =
      current.reminder_status === "cancelled"
        ? null
        : (current.next_dose_date ?? null);

    const sameData =
      new Date(current.started_at).toISOString() === values.vaccineDate &&
      (current.note_text ?? null) === values.note &&
      current.catalog_vaccine_code === catalogCode &&
      current.custom_vaccine_id === customId &&
      current.vaccine_name_snapshot === values.vaccineName &&
      current.dose_kind === values.doseKind &&
      current.dose_number === values.doseNumber &&
      currentNextDoseDate === values.nextDoseDate;

    const repeated =
      current.version === data.version + 1 &&
      current.updated_by_user_id === userId.toLowerCase() &&
      sameData;

    if (!repeated) {
      if (current.version !== data.version) {
        throw createTrackingError(
          "TRACKING_VERSION_CONFLICT",
          "This entry was modified. Reload it before saving.",
          409,
        );
      }

      const reminderChanged =
        currentNextDoseDate !== values.nextDoseDate ||
        current.catalog_vaccine_code !== catalogCode ||
        current.custom_vaccine_id !== customId ||
        current.vaccine_name_snapshot !== values.vaccineName;

      // Une édition de la note ou de la dose ne réactive pas
      // un rappel qui a déjà été terminé.
      if (current.reminder_status === "completed" && reminderChanged) {
        throw createTrackingError(
          "VACCINATION_REMINDER_COMPLETED",
          "A completed reminder cannot be changed from this entry.",
          409,
        );
      }

      if (values.isCustomVaccine) {
        const product = await client.query(
          `
            SELECT id
            FROM child_custom_vaccines
            WHERE id = $1
              AND child_id = $2
              AND archived_at IS NULL
            FOR SHARE
          `,
          [values.vaccineId, childId],
        );

        if (product.rowCount === 0) {
          throw createTrackingError(
            "CUSTOM_VACCINE_UNAVAILABLE",
            "This custom vaccine is unavailable for this child.",
            409,
          );
        }
      }

      await client.query(
        `
          UPDATE tracking_entries
          SET started_at = $3,
              note_text = $4,
              updated_by_user_id = $5,
              updated_at = clock_timestamp(),
              version = version + 1
          WHERE id = $1 AND child_id = $2
        `,
        [entryId, childId, values.vaccineDate, values.note, userId],
      );

      await client.query(
        `
          UPDATE vaccination_details
          SET catalog_vaccine_code = $2,
              custom_vaccine_id = $3,
              vaccine_name_snapshot = $4,
              dose_kind = $5,
              dose_number = $6
          WHERE tracking_entry_id = $1
        `,
        [
          entryId,
          catalogCode,
          customId,
          values.vaccineName,
          values.doseKind,
          values.doseNumber,
        ],
      );

      if (values.nextDoseDate === null) {
        // Conserver le rappel annulé pour propager son annulation
        // aux autres appareils.
        await client.query(
          `
            UPDATE vaccination_reminders
            SET status = 'cancelled',
                cancelled_at = clock_timestamp(),
                completed_at = NULL,
                completed_by_tracking_entry_id = NULL,
                updated_by_user_id = $3,
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE source_tracking_entry_id = $1
              AND child_id = $2
              AND status = 'pending'
          `,
          [entryId, childId, userId],
        );
      } else if (!current.reminder_id) {
        await client.query(
          `
            INSERT INTO vaccination_reminders (
              id,
              child_id,
              source_tracking_entry_id,
              catalog_vaccine_code,
              custom_vaccine_id,
              vaccine_name_snapshot,
              due_date,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $8)
          `,
          [
            randomUUID(),
            childId,
            entryId,
            catalogCode,
            customId,
            values.vaccineName,
            values.nextDoseDate,
            userId,
          ],
        );
      } else if (
        current.reminder_status !== "completed" &&
        (reminderChanged || current.reminder_status === "cancelled")
      ) {
        await client.query(
          `
            UPDATE vaccination_reminders
            SET catalog_vaccine_code = $3,
                custom_vaccine_id = $4,
                vaccine_name_snapshot = $5,
                due_date = $6::date,
                status = 'pending',
                completed_at = NULL,
                completed_by_tracking_entry_id = NULL,
                cancelled_at = NULL,
                updated_by_user_id = $7,
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE source_tracking_entry_id = $1
              AND child_id = $2
          `,
          [
            entryId,
            childId,
            catalogCode,
            customId,
            values.vaccineName,
            values.nextDoseDate,
            userId,
          ],
        );
      }
    }

    const row = await readVaccination(client, childId, entryId);
    const reminder = await readVaccinationReminder(client, childId, entryId);

    await client.query("COMMIT");

    return {
      ...mapVaccination(row),
      reminder,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to roll back vaccination update:", {
        message: rollbackError.message,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getVaccinationEntry,
  createVaccinationEntry,
  updateVaccinationEntry,
  getVaccinationReminders,
};
