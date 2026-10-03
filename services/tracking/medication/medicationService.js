const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const { MEDICATION_CODES } = require("./medicationCatalog");

const UNITS = new Set(["ml", "drops", "tablet", "suppository", "dose"]);

const SELECT_MEDICATION = `
  SELECT
    t.*,
    m.catalog_medication_code,
    m.custom_medication_id,
    m.medication_name_snapshot,
    m.amount_value,
    m.amount_unit
  FROM tracking_entries t
  INNER JOIN medication_details m
    ON m.tracking_entry_id = t.id
`;

function mapMedication(row) {
  const startedAt = new Date(row.started_at).toISOString();

  return {
    id: row.id,
    childId: row.child_id,
    type: "medication",

    medicationId: row.custom_medication_id ?? row.catalog_medication_code,

    medicationName: row.medication_name_snapshot,
    isCustomMedication: row.custom_medication_id !== null,
    amount: Number(row.amount_value),
    unit: row.amount_unit,

    startedAt,
    medicationDate: startedAt,
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

function validateMedicationData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_MEDICATION_ENTRY",
      "Invalid medication entry.",
      400,
    );
  }

  if (
    typeof data.medicationId !== "string" ||
    typeof data.isCustomMedication !== "boolean"
  ) {
    throw createTrackingError(
      "INVALID_MEDICATION_REFERENCE",
      "A valid medication reference is required.",
      400,
    );
  }

  let medicationId = data.medicationId;

  if (data.isCustomMedication) {
    validateUuid(medicationId, "custom medication ID");
    medicationId = medicationId.toLowerCase();
  } else if (!MEDICATION_CODES.has(medicationId)) {
    throw createTrackingError(
      "INVALID_MEDICATION_REFERENCE",
      "Unknown catalog medication.",
      400,
    );
  }

  if (
    typeof data.medicationName !== "string" ||
    data.medicationName.trim().length < 1 ||
    data.medicationName.trim().length > 150
  ) {
    throw createTrackingError(
      "INVALID_MEDICATION_NAME",
      "A medication name of up to 150 characters is required.",
      400,
    );
  }

  if (
    typeof data.amount !== "number" ||
    !Number.isFinite(data.amount) ||
    data.amount <= 0 ||
    data.amount > 9999999.999
  ) {
    throw createTrackingError(
      "INVALID_MEDICATION_AMOUNT",
      "Invalid medication amount.",
      400,
    );
  }

  const amount = Math.round(data.amount * 1000) / 1000;

  if (amount <= 0) {
    throw createTrackingError(
      "INVALID_MEDICATION_AMOUNT",
      "The medication amount is too small.",
      400,
    );
  }

  if (!UNITS.has(data.unit)) {
    throw createTrackingError(
      "INVALID_MEDICATION_UNIT",
      "Invalid medication unit. Volumes must be sent in ml.",
      400,
    );
  }

  if (
    typeof data.medicationDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.medicationDate) ||
    !Number.isFinite(Date.parse(data.medicationDate))
  ) {
    throw createTrackingError(
      "INVALID_MEDICATION_DATE",
      "A valid medication date with a timezone is required.",
      400,
    );
  }

  const medicationDate = new Date(data.medicationDate).toISOString();

  if (Date.parse(medicationDate) > Date.now()) {
    throw createTrackingError(
      "INVALID_MEDICATION_DATE",
      "Medication time cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_MEDICATION_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    medicationId,
    isCustomMedication: data.isCustomMedication,
    medicationName: data.medicationName.trim(),
    amount,
    unit: data.unit,
    medicationDate,
    note: data.note?.trim() || null,
  };
}

async function readMedication(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_MEDICATION}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'medication'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getMedicationEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readMedication(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapMedication(row);
}

async function createMedicationEntry({ childId, userId, data }) {
  const values = validateMedicationData(data);
  const entryId = data.id ?? randomUUID();

  validateUuid(entryId, "tracking entry ID");

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
        VALUES ($1, $2, 'medication', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.medicationDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readMedication(client, childId, entryId);

      const sameData =
        existing &&
        existing.created_by_user_id === userId.toLowerCase() &&
        existing.source === "manual" &&
        new Date(existing.started_at).toISOString() === values.medicationDate &&
        (existing.note_text ?? null) === values.note &&
        existing.catalog_medication_code ===
          (values.isCustomMedication ? null : values.medicationId) &&
        existing.custom_medication_id ===
          (values.isCustomMedication ? values.medicationId : null) &&
        existing.medication_name_snapshot === values.medicationName &&
        Number(existing.amount_value) === values.amount &&
        existing.amount_unit === values.unit;

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
        entry: mapMedication(existing),
      };
    }

    if (values.isCustomMedication) {
      const product = await client.query(
        `
          SELECT id
          FROM child_custom_medications
          WHERE id = $1
            AND child_id = $2
            AND archived_at IS NULL
          FOR SHARE
        `,
        [values.medicationId, childId],
      );

      if (product.rowCount === 0) {
        throw createTrackingError(
          "CUSTOM_MEDICATION_UNAVAILABLE",
          "This custom medication is unavailable for this child.",
          409,
        );
      }
    }

    // Le nom envoyé correspond au nom choisi au moment
    // de la saisie, même si le produit a été renommé ensuite.
    await client.query(
      `
        INSERT INTO medication_details (
          tracking_entry_id,
          catalog_medication_code,
          custom_medication_id,
          medication_name_snapshot,
          amount_value,
          amount_unit
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        entryId,
        values.isCustomMedication ? null : values.medicationId,
        values.isCustomMedication ? values.medicationId : null,
        values.medicationName,
        values.amount,
        values.unit,
      ],
    );

    const row = await readMedication(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapMedication(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getMedicationEntry,
  createMedicationEntry,
};
