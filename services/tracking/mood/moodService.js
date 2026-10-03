const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const MOOD_TYPES = new Set(["happy", "calm", "fussy", "crying", "unwell"]);

const SELECT_MOOD = `
  SELECT
    t.*,
    m.mood_type
  FROM tracking_entries t
  INNER JOIN mood_details m
    ON m.tracking_entry_id = t.id
`;

function mapMood(row) {
  const startedAt = new Date(row.started_at).toISOString();

  return {
    id: row.id,
    childId: row.child_id,
    type: "mood",
    mood: row.mood_type,
    startedAt,
    moodDate: startedAt,
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

function validateMoodData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError("INVALID_MOOD_ENTRY", "Invalid mood entry.", 400);
  }

  if (!MOOD_TYPES.has(data.mood)) {
    throw createTrackingError("INVALID_MOOD_TYPE", "Invalid mood type.", 400);
  }

  if (
    typeof data.moodDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.moodDate) ||
    !Number.isFinite(Date.parse(data.moodDate))
  ) {
    throw createTrackingError(
      "INVALID_MOOD_DATE",
      "A valid mood date with a timezone is required.",
      400,
    );
  }

  const moodDate = new Date(data.moodDate).toISOString();

  if (Date.parse(moodDate) > Date.now()) {
    throw createTrackingError(
      "INVALID_MOOD_DATE",
      "Mood time cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_MOOD_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    mood: data.mood,
    moodDate,
    note: data.note?.trim() || null,
  };
}

async function readMood(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_MOOD}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'mood'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getMoodEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readMood(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapMood(row);
}

async function createMoodEntry({ childId, userId, data }) {
  const values = validateMoodData(data);
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
        VALUES ($1, $2, 'mood', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.moodDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readMood(client, childId, entryId);

      if (!existing || existing.created_by_user_id !== userId.toLowerCase()) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      const sameData =
        existing.source === "manual" &&
        new Date(existing.started_at).toISOString() === values.moodDate &&
        existing.mood_type === values.mood &&
        (existing.note_text ?? null) === values.note;

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
        entry: mapMood(existing),
      };
    }

    await client.query(
      `
        INSERT INTO mood_details (
          tracking_entry_id,
          mood_type
        )
        VALUES ($1, $2)
      `,
      [entryId, values.mood],
    );

    const row = await readMood(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapMood(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getMoodEntry,
  createMoodEntry,
};
