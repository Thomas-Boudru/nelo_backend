const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("./trackingAccess");

const {
  readTrackingPage,
  signTrackingPagePhotos,
} = require("./trackingReadService");

function invalidCursor() {
  return createTrackingError(
    "INVALID_TRACKING_SYNC_CURSOR",
    "Invalid tracking synchronization cursor.",
    400,
  );
}

function decodeCursor(value, childId) {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw invalidCursor();
  }

  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (cursor?.format !== 1 || cursor.childId !== childId.toLowerCase()) {
      throw invalidCursor();
    }

    validateUuid(cursor.id, "cursor entry ID");

    return cursor.id.toLowerCase();
  } catch {
    throw invalidCursor();
  }
}

function encodeCursor(childId, entryId) {
  return Buffer.from(
    JSON.stringify({
      format: 1,
      childId: childId.toLowerCase(),
      id: entryId,
    }),
  ).toString("base64url");
}

function parseLimit(value = "50") {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw createTrackingError(
      "INVALID_TRACKING_LIMIT",
      "Tracking limit must be between 1 and 100.",
      400,
    );
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw createTrackingError(
      "INVALID_TRACKING_LIMIT",
      "Tracking limit must be between 1 and 100.",
      400,
    );
  }

  return limit;
}

async function getTrackingSyncPage({ childId, userId, query = {} }) {
  validateUuid(childId, "child ID");

  const limit = parseLimit(query.limit);

  const afterId =
    query.cursor === undefined ? null : decodeCursor(query.cursor, childId);

  const client = await pool.connect();

  let entries;
  let rows;
  let hasMore;

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    /*
     * Inclure les événements supprimés :
     * SQLite doit connaître leurs suppressions.
     *
     * L'ordre par ID reste stable lorsqu'une date est modifiée.
     */
    const result = await client.query(
      `
        SELECT t.*
        FROM tracking_entries t
        WHERE t.child_id = $1
          AND ($2::uuid IS NULL OR t.id > $2::uuid)
        ORDER BY t.id ASC
        LIMIT $3
      `,
      [childId, afterId, limit + 1],
    );

    hasMore = result.rows.length > limit;
    rows = result.rows.slice(0, limit);

    entries = await readTrackingPage({
      database: client,
      childId,
      rows,
    });

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to roll back tracking synchronization read:", {
        message: rollbackError.message,
      });
    }

    throw error;
  } finally {
    client.release();
  }

  return {
    entries: await signTrackingPagePhotos(entries),
    nextCursor:
      hasMore && rows.length > 0
        ? encodeCursor(childId, rows[rows.length - 1].id)
        : null,
  };
}

module.exports = {
  getTrackingSyncPage,
};
