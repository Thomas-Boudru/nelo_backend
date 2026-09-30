const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const MILK_TYPES = ["formula", "breast_milk", "mixed", "other"];

const SELECT_BOTTLE = `
  SELECT
    t.*,
    b.amount_ml,
    b.bottle_capacity_ml,
    b.content_type
  FROM tracking_entries t
  INNER JOIN bottle_details b
    ON b.tracking_entry_id = t.id
`;

function mapBottle(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: "bottle",
    feedingDate: row.started_at,
    amountMl: Number(row.amount_ml),
    bottleCapacityMl: Number(row.bottle_capacity_ml),
    milkType: row.content_type,
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

function validateAmount(value, name) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 99999.999
  ) {
    throw createTrackingError("INVALID_BOTTLE_AMOUNT", `Invalid ${name}.`, 400);
  }

  const rounded = Math.round(value * 1000) / 1000;

  if (rounded <= 0) {
    throw createTrackingError("INVALID_BOTTLE_AMOUNT", `Invalid ${name}.`, 400);
  }

  return rounded;
}

function validateBottleData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_BOTTLE_ENTRY",
      "Invalid bottle entry.",
      400,
    );
  }

  // Le front envoie une date ISO avec fuseau horaire.
  if (
    typeof data.feedingDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.feedingDate) ||
    Number.isNaN(Date.parse(data.feedingDate))
  ) {
    throw createTrackingError(
      "INVALID_FEEDING_DATE",
      "A valid feeding date with a timezone is required.",
      400,
    );
  }

  if (!MILK_TYPES.includes(data.milkType)) {
    throw createTrackingError("INVALID_MILK_TYPE", "Invalid milk type.", 400);
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
    amountMl: validateAmount(data.amountMl, "bottle amount"),
    bottleCapacityMl: validateAmount(data.bottleCapacityMl, "bottle capacity"),
    milkType: data.milkType,
    note: data.note?.trim() || null,
  };
}

async function readBottle(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_BOTTLE}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'bottle'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getBottleEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readBottle(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapBottle(row);
}

async function createBottleEntry({ childId, userId, data }) {
  const values = validateBottleData(data);
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
        VALUES ($1, $2, 'bottle', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.feedingDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readBottle(client, childId, entryId);

      // Un UUID existant ne permet jamais d'écraser une entrée.
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
        Number(existing.amount_ml) === values.amountMl &&
        Number(existing.bottle_capacity_ml) === values.bottleCapacityMl &&
        existing.content_type === values.milkType;

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
        entry: mapBottle(existing),
      };
    }

    await client.query(
      `
        INSERT INTO bottle_details (
          tracking_entry_id,
          amount_ml,
          bottle_capacity_ml,
          content_type
        )
        VALUES ($1, $2, $3, $4)
      `,
      [entryId, values.amountMl, values.bottleCapacityMl, values.milkType],
    );

    const row = await readBottle(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapBottle(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateBottleEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateBottleData(data);

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
          AND entry_type = 'bottle'
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
      [entryId, childId, values.feedingDate, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE bottle_details
        SET
          amount_ml = $2,
          bottle_capacity_ml = $3,
          content_type = $4
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [entryId, values.amountMl, values.bottleCapacityMl, values.milkType],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "BOTTLE_DETAILS_MISSING",
        "Bottle details are missing.",
        500,
      );
    }

    const row = await readBottle(client, childId, entryId);

    await client.query("COMMIT");

    return mapBottle(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getBottleEntry,
  createBottleEntry,
  updateBottleEntry,
};
