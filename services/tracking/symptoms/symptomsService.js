const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const SYMPTOM_CODES = new Set([
  "irritability",
  "skinRash",
  "runnyNose",
  "cough",
  "fever",
  "unusualBreathing",
  "lowEnergy",
  "lackOfAppetite",
  "regurgitation",
  "vomiting",
  "diarrhea",
  "constipation",
]);

const SELECT_SYMPTOMS = `
  SELECT
    t.*,
    s.symptom_codes
  FROM tracking_entries t
  INNER JOIN symptom_details s
    ON s.tracking_entry_id = t.id
`;

function mapSymptoms(row) {
  const observedAt = new Date(row.started_at).toISOString();

  return {
    id: row.id,
    childId: row.child_id,
    type: "symptoms",
    symptoms: row.symptom_codes,
    observedAt,
    startedAt: observedAt,
    endedAt: null,
    note: row.note_text ?? "",
    source: row.source,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
  };
}

function validateSymptomsData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_SYMPTOMS_ENTRY",
      "Invalid symptoms entry.",
      400,
    );
  }

  if (
    !Array.isArray(data.symptoms) ||
    data.symptoms.length < 1 ||
    data.symptoms.length > SYMPTOM_CODES.size ||
    !data.symptoms.every(
      (code) => typeof code === "string" && SYMPTOM_CODES.has(code),
    )
  ) {
    throw createTrackingError(
      "INVALID_SYMPTOM_CODES",
      "Select at least one valid symptom.",
      400,
    );
  }

  const symptoms = [...new Set(data.symptoms)].sort();

  if (
    typeof data.observedAt !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.observedAt) ||
    !Number.isFinite(Date.parse(data.observedAt))
  ) {
    throw createTrackingError(
      "INVALID_SYMPTOMS_DATE",
      "A valid observation date with a timezone is required.",
      400,
    );
  }

  const observedAt = new Date(data.observedAt).toISOString();

  if (Date.parse(observedAt) > Date.now()) {
    throw createTrackingError(
      "INVALID_SYMPTOMS_DATE",
      "Observation date cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_SYMPTOMS_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    symptoms,
    observedAt,
    note: data.note === undefined ? undefined : data.note?.trim() || null,
  };
}

async function readSymptoms(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_SYMPTOMS}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'symptoms'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

function hasSameData(row, values) {
  const storedSymptoms = [...new Set(row.symptom_codes)].sort();

  return (
    new Date(row.started_at).toISOString() === values.observedAt &&
    (row.note_text ?? null) === values.note &&
    storedSymptoms.length === values.symptoms.length &&
    storedSymptoms.every((code, index) => code === values.symptoms[index])
  );
}

async function getSymptomsEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readSymptoms(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapSymptoms(row);
}

async function createSymptomsEntry({ childId, userId, data }) {
  const values = validateSymptomsData(data);
  values.note = values.note ?? null;

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
          ended_at,
          note_text,
          source,
          created_by_user_id
        )
        VALUES ($1, $2, 'symptoms', $3, NULL, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.observedAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readSymptoms(client, childId, entryId);

      if (
        !existing ||
        existing.created_by_user_id !== userId.toLowerCase() ||
        existing.source !== "manual" ||
        !hasSameData(existing, values)
      ) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used with different data.",
          409,
        );
      }

      // Une nouvelle tentative ne restaure pas une entrée supprimée.
      await client.query("COMMIT");

      return {
        created: false,
        entry: mapSymptoms(existing),
      };
    }

    await client.query(
      `
        INSERT INTO symptom_details (
          tracking_entry_id,
          symptom_codes
        )
        VALUES ($1, $2::TEXT[])
      `,
      [entryId, values.symptoms],
    );

    const row = await readSymptoms(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapSymptoms(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateSymptomsEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateSymptomsData(data);

  if (!Number.isInteger(data.version) || data.version < 1) {
    throw createTrackingError(
      "INVALID_TRACKING_VERSION",
      "A valid tracking version is required.",
      400,
    );
  }

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
          AND entry_type = 'symptoms'
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

    const existing = await readSymptoms(client, childId, entryId);

    if (!existing) {
      throw createTrackingError(
        "SYMPTOM_DETAILS_MISSING",
        "Symptom details are missing.",
        500,
      );
    }

    if (values.note === undefined) {
      values.note = existing.note_text ?? null;
    }

    const existingVersion = Number(existing.version);

    if (existingVersion !== data.version) {
      const isSameRetry =
        existingVersion === data.version + 1 &&
        existing.updated_by_user_id === userId.toLowerCase() &&
        hasSameData(existing, values);

      if (isSameRetry) {
        await client.query("COMMIT");
        return mapSymptoms(existing);
      }

      throw createTrackingError(
        "TRACKING_VERSION_CONFLICT",
        "This entry was modified. Reload it before saving.",
        409,
      );
    }

    await client.query(
      `
        UPDATE tracking_entries
        SET
          started_at = $3,
          note_text = $4,
          updated_by_user_id = $5,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1 AND child_id = $2
      `,
      [entryId, childId, values.observedAt, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE symptom_details
        SET symptom_codes = $2::TEXT[]
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [entryId, values.symptoms],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "SYMPTOM_DETAILS_MISSING",
        "Symptom details are missing.",
        500,
      );
    }

    const row = await readSymptoms(client, childId, entryId);

    await client.query("COMMIT");

    return mapSymptoms(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getSymptomsEntry,
  createSymptomsEntry,
  updateSymptomsEntry,
};
