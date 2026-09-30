const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("./trackingAccess");

function mapEntry(row) {
  const entry = {
    id: row.id,
    childId: row.child_id,
    type: row.entry_type,
    startedAt: row.started_at,
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

  if (row.entry_type === "bottle") {
    entry.feedingDate = row.started_at;
    entry.amountMl = row.amount_ml == null ? null : Number(row.amount_ml);
    entry.bottleCapacityMl =
      row.bottle_capacity_ml == null ? null : Number(row.bottle_capacity_ml);
    entry.milkType = row.content_type;
  }

  return entry;
}

function parseDate(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw createTrackingError(
      "INVALID_TRACKING_DATE",
      `Invalid ${fieldName}.`,
      400,
    );
  }

  return new Date(value).toISOString();
}

function encodeCursor(row) {
  return Buffer.from(
    JSON.stringify({
      startedAt: new Date(row.started_at).toISOString(),
      id: row.id,
    }),
  ).toString("base64url");
}

function decodeCursor(value) {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw createTrackingError(
      "INVALID_TRACKING_CURSOR",
      "Invalid tracking cursor.",
      400,
    );
  }

  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    validateUuid(cursor.id, "cursor ID");

    return {
      id: cursor.id,
      startedAt: parseDate(cursor.startedAt, "cursor date"),
    };
  } catch {
    throw createTrackingError(
      "INVALID_TRACKING_CURSOR",
      "Invalid tracking cursor.",
      400,
    );
  }
}

async function getTrackingEntries({ childId, userId, query = {} }) {
  await requireChildTrackingAccess({ childId, userId });

  const rawLimit = query.limit ?? "30";

  if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
    throw createTrackingError(
      "INVALID_TRACKING_LIMIT",
      "Tracking limit must be between 1 and 100.",
      400,
    );
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw createTrackingError(
      "INVALID_TRACKING_LIMIT",
      "Tracking limit must be between 1 and 100.",
      400,
    );
  }

  const parameters = [childId];
  const conditions = ["t.child_id = $1", "t.deleted_at IS NULL"];

  function addParameter(value) {
    parameters.push(value);
    return `$${parameters.length}`;
  }

  if (query.type !== undefined) {
    if (
      typeof query.type !== "string" ||
      !/^[a-z][a-z0-9_]{0,29}$/.test(query.type)
    ) {
      throw createTrackingError(
        "INVALID_TRACKING_TYPE",
        "Invalid tracking type.",
        400,
      );
    }

    conditions.push(`t.entry_type = ${addParameter(query.type)}`);
  }

  const from =
    query.from === undefined ? null : parseDate(query.from, "start date");

  const to = query.to === undefined ? null : parseDate(query.to, "end date");

  if (from && to && Date.parse(from) >= Date.parse(to)) {
    throw createTrackingError(
      "INVALID_TRACKING_DATE_RANGE",
      "The end date must be after the start date.",
      400,
    );
  }

  if (from) {
    conditions.push(`t.started_at >= ${addParameter(from)}::timestamptz`);
  }

  if (to) {
    // Borne de fin exclusive.
    conditions.push(`t.started_at < ${addParameter(to)}::timestamptz`);
  }

  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    const dateParameter = addParameter(cursor.startedAt);
    const idParameter = addParameter(cursor.id);

    conditions.push(`
      (t.started_at, t.id) <
      (${dateParameter}::timestamptz, ${idParameter}::uuid)
    `);
  }

  const limitParameter = addParameter(limit + 1);

  const result = await pool.query(
    `
      SELECT
        t.*,
        b.amount_ml,
        b.bottle_capacity_ml,
        b.content_type
      FROM tracking_entries t
      LEFT JOIN bottle_details b
        ON b.tracking_entry_id = t.id
        AND t.entry_type = 'bottle'
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.started_at DESC, t.id DESC
      LIMIT ${limitParameter}
    `,
    parameters,
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);

  return {
    entries: rows.map(mapEntry),
    nextCursor:
      hasMore && rows.length > 0 ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

async function deleteTrackingEntry({ childId, userId, entryId, version }) {
  validateUuid(entryId, "tracking entry ID");

  if (!Number.isInteger(version) || version < 1) {
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

    const result = await client.query(
      `
        SELECT *
        FROM tracking_entries
        WHERE id = $1 AND child_id = $2
        FOR UPDATE
      `,
      [entryId, childId],
    );

    if (result.rowCount === 0) {
      throw createTrackingError(
        "TRACKING_ENTRY_NOT_FOUND",
        "Tracking entry not found.",
        404,
      );
    }

    const existing = result.rows[0];

    // Une suppression rejouée ne change pas la version.
    if (existing.deleted_at) {
      await client.query("COMMIT");

      return {
        deleted: true,
        entry: mapEntry(existing),
      };
    }

    if (existing.version !== version) {
      throw createTrackingError(
        "TRACKING_VERSION_CONFLICT",
        "This entry was modified. Reload it before deleting.",
        409,
      );
    }

    const deletedResult = await client.query(
      `
        UPDATE tracking_entries
        SET
          deleted_at = clock_timestamp(),
          deleted_by_user_id = $3,
          updated_by_user_id = $3,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1 AND child_id = $2
        RETURNING *
      `,
      [entryId, childId, userId],
    );

    await client.query("COMMIT");

    return {
      deleted: true,
      entry: mapEntry(deletedResult.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getTrackingEntries,
  deleteTrackingEntry,
};
