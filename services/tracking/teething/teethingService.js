const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const TOOTH_CODES = new Set(
  ["upper", "lower"].flatMap((jaw) =>
    ["left", "right"].flatMap((side) =>
      [
        "central_incisor",
        "lateral_incisor",
        "canine",
        "first_molar",
        "second_molar",
      ].map((tooth) => `${jaw}_${side}_${tooth}`),
    ),
  ),
);

const SELECT_TEETHING = `
  SELECT
    t.*,
    d.tooth_codes,
    to_char(d.eruption_date, 'YYYY-MM-DD') AS eruption_date_text
  FROM tracking_entries t
  INNER JOIN teething_details d
    ON d.tracking_entry_id = t.id
`;

function mapTeething(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: "teething",
    toothCodes: row.tooth_codes,
    eruptionDate: row.eruption_date_text,
    startedAt: new Date(row.started_at).toISOString(),
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

function validateTeethingData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_TEETHING_ENTRY",
      "Invalid teething entry.",
      400,
    );
  }

  if (
    !Array.isArray(data.toothCodes) ||
    data.toothCodes.length < 1 ||
    data.toothCodes.length > 20 ||
    !data.toothCodes.every((code) => TOOTH_CODES.has(code))
  ) {
    throw createTrackingError(
      "INVALID_TOOTH_CODES",
      "Select at least one valid tooth.",
      400,
    );
  }

  const eruptionDate = data.eruptionDate;

  if (
    typeof eruptionDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eruptionDate)
  ) {
    throw createTrackingError(
      "INVALID_ERUPTION_DATE",
      "A valid eruption date is required.",
      400,
    );
  }

  const parsedDate = new Date(`${eruptionDate}T12:00:00.000Z`);

  if (
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== eruptionDate ||
    Number(eruptionDate.slice(0, 4)) < 1
  ) {
    throw createTrackingError(
      "INVALID_ERUPTION_DATE",
      "A valid eruption date is required.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_TEETHING_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    toothCodes: [...new Set(data.toothCodes)].sort(),
    eruptionDate,
    startedAt: parsedDate.toISOString(),
    note: data.note === undefined ? undefined : data.note?.trim() || null,
  };
}

async function readTeething(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_TEETHING}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'teething'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

function hasSameData(row, values) {
  const codes = [...new Set(row.tooth_codes)].sort();

  return (
    row.eruption_date_text === values.eruptionDate &&
    (row.note_text ?? null) === values.note &&
    codes.length === values.toothCodes.length &&
    codes.every((code, index) => code === values.toothCodes[index])
  );
}

// Sérialise les écritures de dentition d'un même enfant.
// Deux appareils ne peuvent pas valider simultanément la même dent.
async function lockChildTeething(client, childId) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`teething:${childId.toLowerCase()}`],
  );
}

async function requireAvailableTeeth(client, childId, entryId, toothCodes) {
  const result = await client.query(
    `
      SELECT t.id
      FROM tracking_entries t
      INNER JOIN teething_details d
        ON d.tracking_entry_id = t.id
      WHERE t.child_id = $1
        AND t.entry_type = 'teething'
        AND t.deleted_at IS NULL
        AND t.id <> $2
        AND d.tooth_codes && $3::TEXT[]
      LIMIT 1
    `,
    [childId, entryId, toothCodes],
  );

  if (result.rowCount > 0) {
    throw createTrackingError(
      "TOOTH_ALREADY_RECORDED",
      "One or more selected teeth have already been recorded.",
      409,
    );
  }
}

async function getTeethingEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readTeething(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapTeething(row);
}

async function createTeethingEntry({ childId, userId, data }) {
  const values = validateTeethingData(data);
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

    await lockChildTeething(client, childId);

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
        VALUES ($1, $2, 'teething', $3, NULL, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.startedAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readTeething(client, childId, entryId);

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

      await client.query("COMMIT");

      return {
        created: false,
        entry: mapTeething(existing),
      };
    }

    await requireAvailableTeeth(client, childId, entryId, values.toothCodes);

    await client.query(
      `
        INSERT INTO teething_details (
          tracking_entry_id,
          tooth_codes,
          eruption_date
        )
        VALUES ($1, $2::TEXT[], $3::DATE)
      `,
      [entryId, values.toothCodes, values.eruptionDate],
    );

    const row = await readTeething(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapTeething(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateTeethingEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateTeethingData(data);

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

    await lockChildTeething(client, childId);

    const locked = await client.query(
      `
        SELECT id
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'teething'
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

    const existing = await readTeething(client, childId, entryId);

    if (!existing) {
      throw createTrackingError(
        "TEETHING_DETAILS_MISSING",
        "Teething details are missing.",
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
        return mapTeething(existing);
      }

      throw createTrackingError(
        "TRACKING_VERSION_CONFLICT",
        "This entry was modified. Reload it before saving.",
        409,
      );
    }

    await requireAvailableTeeth(client, childId, entryId, values.toothCodes);

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
      [entryId, childId, values.startedAt, values.note, userId],
    );

    await client.query(
      `
        UPDATE teething_details
        SET
          tooth_codes = $2::TEXT[],
          eruption_date = $3::DATE
        WHERE tracking_entry_id = $1
      `,
      [entryId, values.toothCodes, values.eruptionDate],
    );

    const row = await readTeething(client, childId, entryId);

    await client.query("COMMIT");

    return mapTeething(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getTeethingEntry,
  createTeethingEntry,
  updateTeethingEntry,
};
