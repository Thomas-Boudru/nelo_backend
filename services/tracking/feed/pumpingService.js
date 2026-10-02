const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const SELECT_PUMPING = `
  SELECT
    t.*,
    p.left_amount_ml,
    p.right_amount_ml
  FROM tracking_entries t
  INNER JOIN pumping_details p
    ON p.tracking_entry_id = t.id
`;

function mapPumping(row) {
  const leftAmountMl = Number(row.left_amount_ml);
  const rightAmountMl = Number(row.right_amount_ml);

  return {
    id: row.id,
    childId: row.child_id,
    type: "pumping",
    pumpingDate: row.started_at,
    startedAt: row.started_at,
    leftAmountMl,
    rightAmountMl,
    totalAmountMl: Math.round((leftAmountMl + rightAmountMl) * 1000) / 1000,
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

function validateVolume(value, name) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 99999.999
  ) {
    throw createTrackingError(
      "INVALID_PUMPING_AMOUNT",
      `Invalid ${name}.`,
      400,
    );
  }

  return Math.round(value * 1000) / 1000;
}

function validatePumpingData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_PUMPING_ENTRY",
      "Invalid pumping entry.",
      400,
    );
  }

  if (
    typeof data.pumpingDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.pumpingDate) ||
    !Number.isFinite(Date.parse(data.pumpingDate))
  ) {
    throw createTrackingError(
      "INVALID_PUMPING_DATE",
      "A valid pumping date with a timezone is required.",
      400,
    );
  }

  const leftAmountMl = validateVolume(data.leftAmountMl, "left pumping amount");

  const rightAmountMl = validateVolume(
    data.rightAmountMl,
    "right pumping amount",
  );

  if (leftAmountMl === 0 && rightAmountMl === 0) {
    throw createTrackingError(
      "INVALID_PUMPING_AMOUNT",
      "The total pumping amount must be greater than zero.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_PUMPING_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    pumpingDate: new Date(data.pumpingDate).toISOString(),
    leftAmountMl,
    rightAmountMl,
    note: data.note?.trim() || null,
  };
}

async function readPumping(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_PUMPING}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'pumping'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getPumpingEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readPumping(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapPumping(row);
}

async function createPumpingEntry({ childId, userId, data }) {
  const values = validatePumpingData(data);
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
        VALUES ($1, $2, 'pumping', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.pumpingDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readPumping(client, childId, entryId);

      if (!existing || existing.created_by_user_id !== userId.toLowerCase()) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      const sameData =
        new Date(existing.started_at).toISOString() === values.pumpingDate &&
        (existing.note_text ?? null) === values.note &&
        Number(existing.left_amount_ml) === values.leftAmountMl &&
        Number(existing.right_amount_ml) === values.rightAmountMl;

      if (!sameData) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "An entry with this ID already has different data.",
          409,
        );
      }

      await client.query("COMMIT");

      return {
        created: false,
        entry: mapPumping(existing),
      };
    }

    await client.query(
      `
        INSERT INTO pumping_details (
          tracking_entry_id,
          left_amount_ml,
          right_amount_ml
        )
        VALUES ($1, $2, $3)
      `,
      [entryId, values.leftAmountMl, values.rightAmountMl],
    );

    const row = await readPumping(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapPumping(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePumpingEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validatePumpingData(data);

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
        SELECT version
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'pumping'
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

    if (locked.rows[0].version !== data.version) {
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
      [entryId, childId, values.pumpingDate, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE pumping_details
        SET
          left_amount_ml = $2,
          right_amount_ml = $3
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [entryId, values.leftAmountMl, values.rightAmountMl],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "PUMPING_DETAILS_MISSING",
        "Pumping details are missing.",
        500,
      );
    }

    const row = await readPumping(client, childId, entryId);

    await client.query("COMMIT");

    return mapPumping(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getPumpingEntry,
  createPumpingEntry,
  updatePumpingEntry,
};
