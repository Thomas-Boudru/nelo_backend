const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const CONTENTS = {
  diaper: ["dry", "wet", "dirty", "wetAndDirty"],
  potty: ["pee", "poop", "peeAndPoop"],
};

const CONSISTENCIES = ["liquid", "soft", "formed", "hard"];

const SELECT_TOILETING = `
  SELECT
    t.*,
    d.toileting_method,
    d.result,
    d.consistency,
    d.is_accident
  FROM tracking_entries t
  INNER JOIN toileting_details d
    ON d.tracking_entry_id = t.id
    AND d.toileting_method = t.entry_type
`;

function mapEntry(row) {
  const startedAt = new Date(row.started_at).toISOString();

  return {
    id: row.id,
    childId: row.child_id,
    type: row.entry_type,
    startedAt,
    endedAt: null,

    ...(row.entry_type === "diaper"
      ? { diaperDate: startedAt }
      : { pottyDate: startedAt }),

    content: row.result,
    consistency: row.consistency,
    isAccident: row.is_accident,
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

function validateData(type, data) {
  if (!Object.hasOwn(CONTENTS, type)) {
    throw createTrackingError(
      "INVALID_TOILETING_TYPE",
      "Invalid toileting type.",
      400,
    );
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_TOILETING_ENTRY",
      "Invalid toileting entry.",
      400,
    );
  }

  const dateField = type === "diaper" ? "diaperDate" : "pottyDate";
  const dateValue = data[dateField];

  if (
    typeof dateValue !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(dateValue) ||
    !Number.isFinite(Date.parse(dateValue))
  ) {
    throw createTrackingError(
      "INVALID_TOILETING_DATE",
      "A valid date with a timezone is required.",
      400,
    );
  }

  const startedAt = new Date(dateValue).toISOString();

  if (Date.parse(startedAt) > Date.now()) {
    throw createTrackingError(
      "INVALID_TOILETING_DATE",
      "The date cannot be in the future.",
      400,
    );
  }

  if (!CONTENTS[type].includes(data.content)) {
    throw createTrackingError(
      "INVALID_TOILETING_CONTENT",
      "Invalid toileting content.",
      400,
    );
  }

  const consistency = data.consistency ?? null;
  const includesPoop =
    type === "diaper" && ["dirty", "wetAndDirty"].includes(data.content);

  if (
    consistency !== null &&
    (!includesPoop || !CONSISTENCIES.includes(consistency))
  ) {
    throw createTrackingError(
      "INVALID_TOILETING_CONSISTENCY",
      "Consistency is only available for a diaper containing stool.",
      400,
    );
  }

  const isAccident = data.isAccident === undefined ? false : data.isAccident;

  if (typeof isAccident !== "boolean" || (type === "diaper" && isAccident)) {
    throw createTrackingError(
      "INVALID_TOILETING_ACCIDENT",
      "An accident can only be recorded for potty time.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_TOILETING_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    startedAt,
    content: data.content,
    consistency,
    isAccident,
    note: data.note?.trim() || null,
  };
}

async function readEntry(database, childId, entryId, type) {
  const result = await database.query(
    `
      ${SELECT_TOILETING}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = $3
    `,
    [entryId, childId, type],
  );

  return result.rows[0] ?? null;
}

async function getToiletingEntry({ childId, userId, entryId, type }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readEntry(pool, childId, entryId, type);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapEntry(row);
}

async function createToiletingEntry({ childId, userId, type, data }) {
  const values = validateData(type, data);
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
        VALUES ($1, $2, $3, $4, $5, 'manual', $6)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, type, values.startedAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readEntry(client, childId, entryId, type);

      if (!existing || existing.created_by_user_id !== userId.toLowerCase()) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      const sameData =
        existing.source === "manual" &&
        new Date(existing.started_at).toISOString() === values.startedAt &&
        (existing.note_text ?? null) === values.note &&
        existing.result === values.content &&
        existing.consistency === values.consistency &&
        existing.is_accident === values.isAccident;

      if (!sameData) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "An entry with this ID already has different data.",
          409,
        );
      }

      // Un réessai ne recrée pas une entrée supprimée.
      await client.query("COMMIT");

      return {
        created: false,
        entry: mapEntry(existing),
      };
    }

    await client.query(
      `
        INSERT INTO toileting_details (
          tracking_entry_id,
          toileting_method,
          result,
          consistency,
          is_accident
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [entryId, type, values.content, values.consistency, values.isAccident],
    );

    const row = await readEntry(client, childId, entryId, type);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapEntry(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getToiletingEntry,
  createToiletingEntry,
};
