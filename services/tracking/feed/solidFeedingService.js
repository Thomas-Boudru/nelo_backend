const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");
const standardFoods = require("../../../data/standardFoodCatalog.json");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const UNITS = new Set([
  "piece",
  "g",
  "ml",
  "teaspoon",
  "tablespoon",
  "portion",
]);

const AMOUNTS_EATEN = new Set([
  "tasted",
  "little",
  "half",
  "almost_all",
  "all",
]);

const REACTIONS = new Set(["liked", "neutral", "disliked"]);

function invalid(code, message) {
  throw createTrackingError(code, message, 400);
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    invalid("INVALID_SOLID_FEEDING", "Invalid solid feeding.");
  }

  if (
    typeof data.feedingDate !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.feedingDate) ||
    !Number.isFinite(Date.parse(data.feedingDate))
  ) {
    invalid(
      "INVALID_SOLID_FEEDING_DATE",
      "A valid feeding date with a timezone is required.",
    );
  }

  if (
    !Array.isArray(data.foods) ||
    data.foods.length < 1 ||
    data.foods.length > 100
  ) {
    invalid(
      "INVALID_SOLID_FEEDING_FOODS",
      "A meal must contain between 1 and 100 foods.",
    );
  }

  const amountEaten = data.amountEaten ?? null;
  const reaction = data.reaction ?? null;

  if (amountEaten !== null && !AMOUNTS_EATEN.has(amountEaten)) {
    invalid("INVALID_AMOUNT_EATEN", "Invalid amount eaten.");
  }

  if (reaction !== null && !REACTIONS.has(reaction)) {
    invalid("INVALID_FOOD_REACTION", "Invalid food reaction.");
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    invalid(
      "INVALID_SOLID_FEEDING_NOTE",
      "The note must not exceed 10000 characters.",
    );
  }

  const foods = data.foods.map((food) => {
    if (
      !food ||
      typeof food !== "object" ||
      Array.isArray(food) ||
      typeof food.foodId !== "string" ||
      typeof food.isCustom !== "boolean"
    ) {
      invalid("INVALID_SOLID_FEEDING_FOOD", "Invalid meal food.");
    }

    if (food.isCustom) {
      validateUuid(food.foodId, "custom food ID");
    } else if (!Object.hasOwn(standardFoods, food.foodId)) {
      invalid("UNKNOWN_STANDARD_FOOD", "Unknown standard food.");
    }

    const amount = food.amount ?? null;
    const unit = food.unit ?? null;

    if ((amount === null) !== (unit === null)) {
      invalid(
        "INVALID_FOOD_QUANTITY",
        "Food amount and unit must be provided together.",
      );
    }

    let normalizedAmount = null;

    if (amount !== null) {
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 999999999.999 ||
        !UNITS.has(unit)
      ) {
        invalid("INVALID_FOOD_QUANTITY", "Invalid food quantity.");
      }

      normalizedAmount = Math.round(amount * 1000) / 1000;

      if (normalizedAmount <= 0) {
        invalid("INVALID_FOOD_QUANTITY", "The quantity is too small.");
      }
    }

    return {
      foodId: food.isCustom ? food.foodId.toLowerCase() : food.foodId,
      isCustom: food.isCustom,
      amount: normalizedAmount,
      unit,
    };
  });

  return {
    feedingDate: new Date(data.feedingDate).toISOString(),
    amountEaten,
    reaction,
    note: data.note?.trim() || null,
    foods,
  };
}

async function transaction(callback) {
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
      console.error("Unable to roll back the solid feeding transaction:", {
        message: rollbackError.message,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function readEntry(database, childId, entryId) {
  const result = await database.query(
    `
      SELECT
        t.*,
        d.amount_eaten,
        d.reaction
      FROM tracking_entries t
      INNER JOIN solid_feeding_details d
        ON d.tracking_entry_id = t.id
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'solids'
    `,
    [entryId, childId],
  );

  const row = result.rows[0];

  if (!row) return null;

  const items = await database.query(
    `
      SELECT *
      FROM solid_feeding_items
      WHERE tracking_entry_id = $1
      ORDER BY sort_order ASC
    `,
    [entryId],
  );

  return {
    id: row.id,
    childId: row.child_id,
    type: "solids",
    feedingDate: row.started_at,
    startedAt: row.started_at,
    amountEaten: row.amount_eaten,
    reaction: row.reaction,
    note: row.note_text ?? "",
    foods: items.rows.map((item) => ({
      id: item.id,
      foodId: item.custom_food_id ?? item.standard_food_id,
      isCustom: item.custom_food_id !== null,
      name: item.food_name_snapshot,
      translationKey: item.standard_food_id
        ? (standardFoods[item.standard_food_id]?.translationKey ?? null)
        : null,
      amount: item.quantity_value === null ? null : Number(item.quantity_value),
      unit: item.quantity_unit,
      sortOrder: item.sort_order,
    })),
    source: row.source,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
  };
}

function sameData(entry, values) {
  const storedFoods = entry.foods.map((food) => ({
    foodId: food.foodId,
    isCustom: food.isCustom,
    amount: food.amount,
    unit: food.unit,
  }));

  return (
    new Date(entry.startedAt).toISOString() === values.feedingDate &&
    (entry.note || null) === values.note &&
    entry.amountEaten === values.amountEaten &&
    entry.reaction === values.reaction &&
    JSON.stringify(storedFoods) === JSON.stringify(values.foods)
  );
}

async function resolveFoods(client, childId, foods) {
  const customIds = [
    ...new Set(
      foods.filter((food) => food.isCustom).map((food) => food.foodId),
    ),
  ];

  const customFoods = new Map();

  if (customIds.length > 0) {
    const result = await client.query(
      `
        SELECT id, name
        FROM child_custom_foods
        WHERE child_id = $1
          AND id = ANY($2::uuid[])
          AND deleted_at IS NULL
        ORDER BY id
        FOR SHARE
      `,
      [childId, customIds],
    );

    for (const food of result.rows) {
      customFoods.set(food.id, food);
    }

    if (customFoods.size !== customIds.length) {
      invalid(
        "CUSTOM_FOOD_UNAVAILABLE",
        "A custom food is unavailable for this child.",
      );
    }
  }

  return foods.map((food) => ({
    ...food,
    nameSnapshot: food.isCustom
      ? customFoods.get(food.foodId).name
      : standardFoods[food.foodId].translationKey,
  }));
}

async function insertItems(client, { childId, entryId, foods }) {
  for (const [sortOrder, food] of foods.entries()) {
    await client.query(
      `
        INSERT INTO solid_feeding_items (
          id,
          tracking_entry_id,
          child_id,
          standard_food_id,
          custom_food_id,
          food_name_snapshot,
          quantity_value,
          quantity_unit,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        entryId,
        childId,
        food.isCustom ? null : food.foodId,
        food.isCustom ? food.foodId : null,
        food.nameSnapshot,
        food.amount,
        food.unit,
        sortOrder,
      ],
    );
  }
}

async function getSolidFeedingEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  return transaction(async (client) => {
    // Une seule vue cohérente du repas et de ses aliments.
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    const entry = await readEntry(client, childId, entryId);

    if (!entry || entry.deletedAt) {
      throw createTrackingError(
        "TRACKING_ENTRY_NOT_FOUND",
        "Tracking entry not found.",
        404,
      );
    }

    return entry;
  });
}

async function createSolidFeedingEntry({ childId, userId, data }) {
  const values = validateData(data);
  const entryId = data.id ?? randomUUID();

  validateUuid(entryId, "tracking entry ID");

  return transaction(async (client) => {
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
        VALUES ($1, $2, 'solids', $3, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.feedingDate, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      await client.query(
        `
          SELECT id
          FROM tracking_entries
          WHERE id = $1 AND child_id = $2
          FOR UPDATE
        `,
        [entryId, childId],
      );

      const existing = await readEntry(client, childId, entryId);

      if (
        !existing ||
        existing.deletedAt ||
        existing.version !== 1 ||
        existing.createdByUserId !== userId.toLowerCase() ||
        !sameData(existing, values)
      ) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This entry ID is already used or has different data.",
          409,
        );
      }

      return { created: false, entry: existing };
    }

    const foods = await resolveFoods(client, childId, values.foods);

    await client.query(
      `
        INSERT INTO solid_feeding_details (
          tracking_entry_id,
          amount_eaten,
          reaction
        )
        VALUES ($1, $2, $3)
      `,
      [entryId, values.amountEaten, values.reaction],
    );

    await insertItems(client, { childId, entryId, foods });

    return {
      created: true,
      entry: await readEntry(client, childId, entryId),
    };
  });
}

async function updateSolidFeedingEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateData(data);

  if (!Number.isInteger(data.version) || data.version < 1) {
    invalid(
      "INVALID_TRACKING_VERSION",
      "A valid tracking version is required.",
    );
  }

  return transaction(async (client) => {
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
          AND entry_type = 'solids'
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

    const foods = await resolveFoods(client, childId, values.foods);

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
        UPDATE solid_feeding_details
        SET amount_eaten = $2, reaction = $3
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [entryId, values.amountEaten, values.reaction],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "SOLID_FEEDING_DETAILS_MISSING",
        "Solid feeding details are missing.",
        500,
      );
    }

    await client.query(
      `
        DELETE FROM solid_feeding_items
        WHERE tracking_entry_id = $1
      `,
      [entryId],
    );

    await insertItems(client, { childId, entryId, foods });

    return readEntry(client, childId, entryId);
  });
}

module.exports = {
  getSolidFeedingEntry,
  createSolidFeedingEntry,
  updateSolidFeedingEntry,
};
