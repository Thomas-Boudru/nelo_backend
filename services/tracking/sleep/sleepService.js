const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const SLEEP_TYPES = ["nap", "night"];

const SELECT_SLEEP = `
  SELECT
    t.*,
    s.sleep_type,
    s.ended_by_user_id
  FROM tracking_entries t
  INNER JOIN sleep_details s
    ON s.tracking_entry_id = t.id
`;

function mapSleep(row) {
  const startedAt = new Date(row.started_at).toISOString();
  const endedAt = row.ended_at ? new Date(row.ended_at).toISOString() : null;

  return {
    id: row.id,
    childId: row.child_id,
    type: "sleep",
    sleepType: row.sleep_type,
    startedAt,
    endedAt,
    durationSeconds: endedAt
      ? Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
      : null,
    note: row.note_text ?? "",
    source: row.source,
    endedByUserId: row.ended_by_user_id,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
  };
}

function validateDate(value, name) {
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw createTrackingError(
      "INVALID_SLEEP_DATE",
      `A valid ${name} with a timezone is required.`,
      400,
    );
  }

  return new Date(value).toISOString();
}

function validateManualSleepData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_SLEEP_ENTRY",
      "Invalid sleep entry.",
      400,
    );
  }

  if (!SLEEP_TYPES.includes(data.sleepType)) {
    throw createTrackingError("INVALID_SLEEP_TYPE", "Invalid sleep type.", 400);
  }

  const startedAt = validateDate(data.startedAt, "start date");
  const endedAt = validateDate(data.endedAt, "end date");

  const startTime = Date.parse(startedAt);
  const endTime = Date.parse(endedAt);
  const now = Date.now();

  if (endTime <= startTime) {
    throw createTrackingError(
      "INVALID_SLEEP_PERIOD",
      "End time must be after start time.",
      400,
    );
  }

  if (startTime > now || endTime > now) {
    throw createTrackingError(
      "INVALID_SLEEP_DATE",
      "Sleep dates cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_SLEEP_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    sleepType: data.sleepType,
    startedAt,
    endedAt,
    note: data.note?.trim() || null,
  };
}

async function readSleep(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_SLEEP}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'sleep'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getSleepEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readSleep(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapSleep(row);
}

async function createSleepEntry({ childId, userId, data }) {
  const values = validateManualSleepData(data);
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
        VALUES ($1, $2, 'sleep', $3, $4, $5, 'manual', $6)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.startedAt, values.endedAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readSleep(client, childId, entryId);

      if (!existing || existing.created_by_user_id !== userId.toLowerCase()) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      const sameData =
        new Date(existing.started_at).toISOString() === values.startedAt &&
        existing.ended_at != null &&
        new Date(existing.ended_at).toISOString() === values.endedAt &&
        (existing.note_text ?? null) === values.note &&
        existing.sleep_type === values.sleepType &&
        existing.source === "manual";

      if (!sameData) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "An entry with this ID already has different data.",
          409,
        );
      }

      // Une nouvelle tentative ne recrée pas une entrée supprimée.
      await client.query("COMMIT");

      return {
        created: false,
        entry: mapSleep(existing),
      };
    }

    await client.query(
      `
        INSERT INTO sleep_details (
          tracking_entry_id,
          sleep_type,
          ended_by_user_id
        )
        VALUES ($1, $2, NULL)
      `,
      [entryId, values.sleepType],
    );

    const row = await readSleep(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapSleep(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateSleepEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateManualSleepData(data);

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
        SELECT version, ended_at
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'sleep'
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

    const existing = locked.rows[0];

    if (existing.version !== data.version) {
      throw createTrackingError(
        "TRACKING_VERSION_CONFLICT",
        "This entry was modified. Reload it before saving.",
        409,
      );
    }

    // L'arrêt d'un chronomètre sera traité séparément.
    if (existing.ended_at == null) {
      throw createTrackingError(
        "SLEEP_STILL_RUNNING",
        "Stop this sleep timer before editing the completed sleep.",
        409,
      );
    }

    await client.query(
      `
        UPDATE tracking_entries
        SET
          started_at = $3,
          ended_at = $4,
          note_text = $5,
          updated_by_user_id = $6,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1 AND child_id = $2
      `,
      [entryId, childId, values.startedAt, values.endedAt, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE sleep_details
        SET sleep_type = $2
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [entryId, values.sleepType],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "SLEEP_DETAILS_MISSING",
        "Sleep details are missing.",
        500,
      );
    }

    const row = await readSleep(client, childId, entryId);

    await client.query("COMMIT");

    return mapSleep(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getSleepEntry,
  createSleepEntry,
  updateSleepEntry,
};
