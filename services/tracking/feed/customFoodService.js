const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const ALLOWED_UNITS = new Set([
  "piece",
  "g",
  "ml",
  "teaspoon",
  "tablespoon",
  "portion",
]);

function normalizeFoodName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCustomFood(row) {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    emoji: row.emoji,
    suggestedUnit: row.suggested_unit,
    isCustom: true,
    translationKey: null,
    image: null,
    version: row.version,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function validateFoodData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD",
      "Invalid custom food.",
      400,
    );
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";

  if (!name || name.length > 150) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD_NAME",
      "The food name must contain between 1 and 150 characters.",
      400,
    );
  }

  const normalizedName = normalizeFoodName(name);

  if (!normalizedName) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD_NAME",
      "A valid food name is required.",
      400,
    );
  }

  const suggestedUnit = data.suggestedUnit ?? "piece";

  if (!ALLOWED_UNITS.has(suggestedUnit)) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD_UNIT",
      "Invalid suggested food unit.",
      400,
    );
  }

  const emoji = data.emoji ?? "🥣";

  if (typeof emoji !== "string" || !emoji.trim() || emoji.length > 32) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD_EMOJI",
      "Invalid food emoji.",
      400,
    );
  }

  return {
    name,
    normalizedName,
    suggestedUnit,
    emoji: emoji.trim(),
  };
}

function validateVersion(version) {
  if (!Number.isInteger(version) || version < 1) {
    throw createTrackingError(
      "INVALID_CUSTOM_FOOD_VERSION",
      "A valid food version is required.",
      400,
    );
  }
}

function translateDatabaseError(error) {
  if (
    error.code === "23505" &&
    error.constraint === "child_custom_foods_active_name_idx"
  ) {
    return createTrackingError(
      "CUSTOM_FOOD_NAME_CONFLICT",
      "An active food with this name already exists for this child.",
      409,
    );
  }

  return error;
}

async function runTransaction(callback) {
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
      console.error("Unable to roll back the custom food transaction:", {
        message: rollbackError.message,
      });
    }

    throw translateDatabaseError(error);
  } finally {
    client.release();
  }
}

async function listCustomFoods({ childId, userId }) {
  await requireChildTrackingAccess({ childId, userId });

  const result = await pool.query(
    `
      SELECT *
      FROM child_custom_foods
      WHERE child_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [childId],
  );

  // Les suppressions sont incluses pour permettre au téléphone
  // de retirer aussi les aliments supprimés sur un autre appareil.
  return result.rows.map(mapCustomFood);
}

async function createCustomFood({ childId, userId, data }) {
  const values = validateFoodData(data);
  const foodId = data.id ?? randomUUID();

  validateUuid(foodId, "custom food ID");

  return runTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const inserted = await client.query(
      `
        INSERT INTO child_custom_foods (
          id,
          child_id,
          name,
          normalized_name,
          emoji,
          suggested_unit,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `,
      [
        foodId,
        childId,
        values.name,
        values.normalizedName,
        values.emoji,
        values.suggestedUnit,
        userId,
      ],
    );

    if (inserted.rowCount > 0) {
      return {
        created: true,
        food: mapCustomFood(inserted.rows[0]),
      };
    }

    const existing = await client.query(
      `
        SELECT *
        FROM child_custom_foods
        WHERE id = $1 AND child_id = $2
      `,
      [foodId, childId],
    );

    const row = existing.rows[0];

    const sameCreation =
      row &&
      row.created_by_user_id === userId.toLowerCase() &&
      row.version === 1 &&
      row.deleted_at === null &&
      row.name === values.name &&
      row.normalized_name === values.normalizedName &&
      row.emoji === values.emoji &&
      row.suggested_unit === values.suggestedUnit;

    if (!sameCreation) {
      throw createTrackingError(
        "CUSTOM_FOOD_ID_CONFLICT",
        "This food ID is already used or has different data.",
        409,
      );
    }

    // Même UUID et mêmes données : reprise d'une création
    // dont la réponse a pu être perdue.
    return {
      created: false,
      food: mapCustomFood(row),
    };
  });
}

async function lockCustomFood(client, { childId, foodId }) {
  const result = await client.query(
    `
      SELECT *
      FROM child_custom_foods
      WHERE id = $1 AND child_id = $2
      FOR UPDATE
    `,
    [foodId, childId],
  );

  if (result.rowCount === 0) {
    throw createTrackingError(
      "CUSTOM_FOOD_NOT_FOUND",
      "Custom food not found.",
      404,
    );
  }

  return result.rows[0];
}

async function updateCustomFood({ childId, userId, foodId, data }) {
  validateUuid(foodId, "custom food ID");

  const values = validateFoodData(data);

  validateVersion(data.version);

  return runTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const current = await lockCustomFood(client, { childId, foodId });

    if (current.deleted_at) {
      throw createTrackingError(
        "CUSTOM_FOOD_NOT_FOUND",
        "Custom food not found.",
        404,
      );
    }

    if (current.version !== data.version) {
      const alreadyApplied =
        current.version === data.version + 1 &&
        current.updated_by_user_id === userId.toLowerCase() &&
        current.name === values.name &&
        current.normalized_name === values.normalizedName &&
        current.emoji === values.emoji &&
        current.suggested_unit === values.suggestedUnit;

      if (alreadyApplied) {
        return mapCustomFood(current);
      }

      throw createTrackingError(
        "CUSTOM_FOOD_VERSION_CONFLICT",
        "This food was modified. Reload it before saving.",
        409,
      );
    }

    const result = await client.query(
      `
        UPDATE child_custom_foods
        SET
          name = $3,
          normalized_name = $4,
          emoji = $5,
          suggested_unit = $6,
          updated_by_user_id = $7,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1 AND child_id = $2
        RETURNING *
      `,
      [
        foodId,
        childId,
        values.name,
        values.normalizedName,
        values.emoji,
        values.suggestedUnit,
        userId,
      ],
    );

    return mapCustomFood(result.rows[0]);
  });
}

async function deleteCustomFood({ childId, userId, foodId, version }) {
  validateUuid(foodId, "custom food ID");
  validateVersion(version);

  return runTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const current = await lockCustomFood(client, { childId, foodId });

    // Répéter une suppression ne modifie plus la ligne.
    if (current.deleted_at) {
      return {
        removed: false,
        food: mapCustomFood(current),
      };
    }

    if (current.version !== version) {
      throw createTrackingError(
        "CUSTOM_FOOD_VERSION_CONFLICT",
        "This food was modified. Reload it before deleting.",
        409,
      );
    }

    const result = await client.query(
      `
        UPDATE child_custom_foods
        SET
          deleted_at = clock_timestamp(),
          updated_at = clock_timestamp(),
          updated_by_user_id = $3,
          version = version + 1
        WHERE id = $1 AND child_id = $2
        RETURNING *
      `,
      [foodId, childId, userId],
    );

    return {
      removed: true,
      food: mapCustomFood(result.rows[0]),
    };
  });
}

module.exports = {
  listCustomFoods,
  createCustomFood,
  updateCustomFood,
  deleteCustomFood,
};
