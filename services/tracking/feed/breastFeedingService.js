const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const SELECT_BREASTFEEDING = `
  SELECT
    t.*,
    b.left_duration_seconds,
    b.right_duration_seconds,
    b.first_side,
    b.last_side
  FROM tracking_entries t
  INNER JOIN breastfeeding_details b
    ON b.tracking_entry_id = t.id
`;

function mapBreastfeeding(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: "breastfeeding",
    feedingDate: row.started_at,
    startedAt: row.started_at,
    leftDurationSeconds: row.left_duration_seconds,
    rightDurationSeconds: row.right_duration_seconds,
    firstSide: row.first_side,
    lastSide: row.last_side,
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

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_BREASTFEEDING_ENTRY",
      "Invalid breastfeeding entry.",
      400,
    );
  }

  if (
    typeof data.feedingDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.feedingDate) ||
    !Number.isFinite(Date.parse(data.feedingDate))
  ) {
    throw createTrackingError(
      "INVALID_FEEDING_DATE",
      "A valid feeding date with a timezone is required.",
      400,
    );
  }

  const left = data.leftDurationSeconds ?? 0;
  const right = data.rightDurationSeconds ?? 0;

  const validDuration = (value) =>
    Number.isInteger(value) && value >= 0 && value <= 2147483647;

  if (
    !validDuration(left) ||
    !validDuration(right) ||
    (left === 0 && right === 0)
  ) {
    throw createTrackingError(
      "INVALID_BREASTFEEDING_DURATION",
      "Invalid breastfeeding duration.",
      400,
    );
  }

  for (const side of [data.firstSide, data.lastSide]) {
    if (side != null && !["left", "right"].includes(side)) {
      throw createTrackingError(
        "INVALID_BREASTFEEDING_SIDE",
        "Invalid breastfeeding side.",
        400,
      );
    }
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_FEEDING_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    feedingDate: new Date(data.feedingDate).toISOString(),
    leftDurationSeconds: left,
    rightDurationSeconds: right,
    firstSide: data.firstSide ?? null,
    lastSide: data.lastSide ?? null,
    note: data.note?.trim() || null,
  };
}

async function readEntry(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_BREASTFEEDING}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'breastfeeding'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getBreastfeedingEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readEntry(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapBreastfeeding(row);
}

async function createBreastfeedingEntry({ childId, userId, data }) {
  const values = validateData(data);
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
        VALUES ($1, $2, 'breastfeeding', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.feedingDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readEntry(client, childId, entryId);

      if (!existing || existing.created_by_user_id !== userId.toLowerCase()) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      const sameData =
        new Date(existing.started_at).toISOString() === values.feedingDate &&
        (existing.note_text ?? null) === values.note &&
        existing.left_duration_seconds === values.leftDurationSeconds &&
        existing.right_duration_seconds === values.rightDurationSeconds &&
        existing.first_side === values.firstSide &&
        existing.last_side === values.lastSide;

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
        entry: mapBreastfeeding(existing),
      };
    }

    await client.query(
      `
        INSERT INTO breastfeeding_details (
          tracking_entry_id,
          left_duration_seconds,
          right_duration_seconds,
          first_side,
          last_side
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        entryId,
        values.leftDurationSeconds,
        values.rightDurationSeconds,
        values.firstSide,
        values.lastSide,
      ],
    );

    const row = await readEntry(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapBreastfeeding(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateBreastfeedingEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateData(data);

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
          AND entry_type = 'breastfeeding'
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
        SET started_at = $3,
            note_text = $4,
            updated_by_user_id = $5,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = $1 AND child_id = $2
      `,
      [entryId, childId, values.feedingDate, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE breastfeeding_details
        SET left_duration_seconds = $2,
            right_duration_seconds = $3,
            first_side = $4,
            last_side = $5
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [
        entryId,
        values.leftDurationSeconds,
        values.rightDurationSeconds,
        values.firstSide,
        values.lastSide,
      ],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "BREASTFEEDING_DETAILS_MISSING",
        "Breastfeeding details are missing.",
        500,
      );
    }

    const row = await readEntry(client, childId, entryId);

    await client.query("COMMIT");

    return mapBreastfeeding(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getBreastfeedingEntry,
  createBreastfeedingEntry,
  updateBreastfeedingEntry,
};
