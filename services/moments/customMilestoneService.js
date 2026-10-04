const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../tracking/trackingAccess");

const CATEGORIES = new Set([
  "development",
  "feeding",
  "sleep",
  "growth",
  "daily-life",
]);

function fail(code, message, status = 400) {
  throw createTrackingError(code, message, status);
}

function validateVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1) {
    fail("INVALID_MILESTONE_VERSION", "Invalid milestone version.");
  }

  return version;
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("INVALID_CUSTOM_MILESTONE", "Invalid custom milestone.");
  }

  if (typeof data.name !== "string") {
    fail("INVALID_MILESTONE_NAME", "Invalid milestone name.");
  }

  const name = data.name.normalize("NFKC").trim().replace(/\s+/gu, " ");

  if (!name || name.length > 150) {
    fail(
      "INVALID_MILESTONE_NAME",
      "The milestone name must contain between 1 and 150 characters.",
    );
  }

  if (!CATEGORIES.has(data.categoryCode)) {
    fail("INVALID_MILESTONE_CATEGORY", "Invalid milestone category.");
  }

  return {
    name,
    normalizedName: name.toLowerCase(),
    categoryCode: data.categoryCode,
  };
}

function mapMilestone(row) {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    categoryCode: row.category_code,

    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,

    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),

    archivedAt: row.archived_at
      ? new Date(row.archived_at).toISOString()
      : null,

    version: row.version,
  };
}

function hasSameContent(row, data) {
  return (
    row.name === data.name &&
    row.normalized_name === data.normalizedName &&
    row.category_code === data.categoryCode
  );
}

function throwVersionConflict() {
  fail(
    "CUSTOM_MILESTONE_VERSION_CONFLICT",
    "This milestone has been modified. Reload it before trying again.",
    409,
  );
}

function throwNotFound() {
  fail("CUSTOM_MILESTONE_NOT_FOUND", "Custom milestone not found.", 404);
}

function mapDatabaseError(error) {
  if (
    error.code === "23505" &&
    error.constraint === "idx_custom_milestones_active_name"
  ) {
    return createTrackingError(
      "CUSTOM_MILESTONE_ALREADY_EXISTS",
      "A milestone with this name already exists in this category.",
      409,
    );
  }

  return error;
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to roll back the milestone transaction:", {
        message: rollbackError.message,
      });
    }

    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

function parseLimit(value) {
  if (value === undefined) {
    return 50;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("INVALID_PAGE_LIMIT", "Invalid page limit.");
  }

  const limit = Number(value);

  if (!Number.isSafeInteger(limit) || limit > 100) {
    fail("INVALID_PAGE_LIMIT", "The page limit must be between 1 and 100.");
  }

  return limit;
}

function parseIncludeArchived(value) {
  if (value === undefined || value === "false") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  fail("INVALID_ARCHIVE_FILTER", "Invalid archived milestone filter.");
}

async function listCustomMilestones({
  childId,
  userId,
  cursor,
  limit,
  includeArchived,
}) {
  const pageLimit = parseLimit(limit);
  const showArchived = parseIncludeArchived(includeArchived);

  // Le curseur correspond au dernier UUID reçu.
  // Cet ordre est stable pour parcourir le catalogue.
  if (cursor !== undefined) {
    validateUuid(cursor, "milestone cursor");
  }

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    const result = await client.query(
      `
        SELECT *
        FROM child_custom_milestones
        WHERE child_id = $1
          AND ($2::boolean OR archived_at IS NULL)
          AND ($3::uuid IS NULL OR id > $3::uuid)
        ORDER BY id ASC
        LIMIT $4
      `,
      [childId, showArchived, cursor ?? null, pageLimit + 1],
    );

    const hasMore = result.rows.length > pageLimit;
    const rows = result.rows.slice(0, pageLimit);

    return {
      milestones: rows.map(mapMilestone),

      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : null,
    };
  });
}

async function createCustomMilestone({ childId, userId, data }) {
  const normalized = validateData(data);

  validateUuid(data.id, "custom milestone ID");

  const milestoneId = data.id.toLowerCase();

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const inserted = await client.query(
      `
        INSERT INTO child_custom_milestones (
          id,
          child_id,
          name,
          normalized_name,
          category_code,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at,
          version
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $6,
          clock_timestamp(),
          clock_timestamp(),
          1
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `,
      [
        milestoneId,
        childId,
        normalized.name,
        normalized.normalizedName,
        normalized.categoryCode,
        userId,
      ],
    );

    if (inserted.rowCount > 0) {
      return {
        created: true,
        milestone: mapMilestone(inserted.rows[0]),
      };
    }

    // Une création déjà enregistrée peut être renvoyée
    // après la perte de sa première réponse.
    const existing = await client.query(
      `
        SELECT *
        FROM child_custom_milestones
        WHERE id = $1
          AND child_id = $2
        FOR UPDATE
      `,
      [milestoneId, childId],
    );

    const current = existing.rows[0];

    if (
      !current ||
      current.archived_at ||
      current.created_by_user_id !== userId.toLowerCase() ||
      !hasSameContent(current, normalized)
    ) {
      fail(
        "CUSTOM_MILESTONE_ID_CONFLICT",
        "This custom milestone ID is already used.",
        409,
      );
    }

    return {
      created: false,
      milestone: mapMilestone(current),
    };
  });
}

async function updateCustomMilestone({ childId, userId, milestoneId, data }) {
  validateUuid(milestoneId, "custom milestone ID");

  const normalized = validateData(data);
  const expectedVersion = validateVersion(data.version);

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const existing = await client.query(
      `
        SELECT *
        FROM child_custom_milestones
        WHERE id = $1
          AND child_id = $2
        FOR UPDATE
      `,
      [milestoneId, childId],
    );

    const current = existing.rows[0];

    if (!current) {
      throwNotFound();
    }

    if (current.archived_at) {
      fail(
        "CUSTOM_MILESTONE_ARCHIVED",
        "This milestone has been archived.",
        409,
      );
    }

    // Répétition immédiate d'une modification dont la réponse
    // n'est pas arrivée au téléphone.
    const isRepeatedUpdate =
      current.version === expectedVersion + 1 &&
      current.updated_by_user_id === userId.toLowerCase() &&
      hasSameContent(current, normalized);

    if (isRepeatedUpdate) {
      return mapMilestone(current);
    }

    if (current.version !== expectedVersion) {
      throwVersionConflict();
    }

    const updated = await client.query(
      `
        UPDATE child_custom_milestones
        SET
          name = $3,
          normalized_name = $4,
          category_code = $5,
          updated_by_user_id = $6,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1
          AND child_id = $2
          AND archived_at IS NULL
          AND version = $7
        RETURNING *
      `,
      [
        milestoneId,
        childId,
        normalized.name,
        normalized.normalizedName,
        normalized.categoryCode,
        userId,
        expectedVersion,
      ],
    );

    if (updated.rowCount === 0) {
      throwVersionConflict();
    }

    // Les snapshots des souvenirs existants restent inchangés.
    return mapMilestone(updated.rows[0]);
  });
}

async function archiveCustomMilestone({ childId, userId, milestoneId, data }) {
  validateUuid(milestoneId, "custom milestone ID");

  const expectedVersion = validateVersion(data?.version);

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const existing = await client.query(
      `
        SELECT *
        FROM child_custom_milestones
        WHERE id = $1
          AND child_id = $2
        FOR UPDATE
      `,
      [milestoneId, childId],
    );

    const current = existing.rows[0];

    if (!current) {
      throwNotFound();
    }

    // L'état demandé est déjà atteint.
    // Ne pas augmenter à nouveau la version.
    if (current.archived_at) {
      return {
        archived: true,
        milestone: mapMilestone(current),
      };
    }

    if (current.version !== expectedVersion) {
      throwVersionConflict();
    }

    const updated = await client.query(
      `
        UPDATE child_custom_milestones
        SET
          archived_at = clock_timestamp(),
          updated_at = clock_timestamp(),
          updated_by_user_id = $3,
          version = version + 1
        WHERE id = $1
          AND child_id = $2
          AND archived_at IS NULL
          AND version = $4
        RETURNING *
      `,
      [milestoneId, childId, userId, expectedVersion],
    );

    if (updated.rowCount === 0) {
      throwVersionConflict();
    }

    return {
      archived: true,
      milestone: mapMilestone(updated.rows[0]),
    };
  });
}

module.exports = {
  listCustomMilestones,
  createCustomMilestone,
  updateCustomMilestone,
  archiveCustomMilestone,
};
