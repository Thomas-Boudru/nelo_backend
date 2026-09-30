const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const ML_PER_US_FL_OZ = 29.5735295625;

function mapPreset(row) {
  return {
    id: row.id,
    childId: row.child_id,
    label: row.label,
    capacityMl: Number(row.capacity_ml),
    originalValue: Number(row.original_value),
    originalUnit: row.original_unit,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    version: row.version,
  };
}

function validatePresetData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET",
      "Invalid bottle preset.",
      400,
    );
  }

  const originalValue = data.originalValue;
  const originalUnit = data.originalUnit ?? "ml";

  if (
    typeof originalValue !== "number" ||
    !Number.isFinite(originalValue) ||
    originalValue <= 0 ||
    originalValue > 99999.999
  ) {
    throw createTrackingError(
      "INVALID_BOTTLE_CAPACITY",
      "Invalid bottle capacity.",
      400,
    );
  }

  if (!["ml", "fl_oz"].includes(originalUnit)) {
    throw createTrackingError(
      "INVALID_VOLUME_UNIT",
      "Invalid volume unit.",
      400,
    );
  }

  if (data.label != null && typeof data.label !== "string") {
    throw createTrackingError(
      "INVALID_BOTTLE_LABEL",
      "Invalid bottle label.",
      400,
    );
  }

  const label = data.label?.trim() || null;

  if (label && label.length > 80) {
    throw createTrackingError(
      "INVALID_BOTTLE_LABEL",
      "Bottle label must not exceed 80 characters.",
      400,
    );
  }

  const storedOriginalValue = Math.round(originalValue * 1000) / 1000;

  const capacityMl =
    Math.round(
      storedOriginalValue *
        (originalUnit === "fl_oz" ? ML_PER_US_FL_OZ : 1) *
        1000,
    ) / 1000;

  if (storedOriginalValue <= 0 || capacityMl <= 0 || capacityMl > 99999.999) {
    throw createTrackingError(
      "INVALID_BOTTLE_CAPACITY",
      "Invalid bottle capacity.",
      400,
    );
  }

  const id = data.id ?? randomUUID();

  validateUuid(id, "bottle preset ID");

  return {
    id: id.toLowerCase(),
    label,
    originalValue: storedOriginalValue,
    originalUnit,
    capacityMl,
  };
}

async function getBottlePresets({ childId, userId }) {
  await requireChildTrackingAccess({ childId, userId });

  // Les presets archivés sont inclus pour que le cache local
  // puisse également prendre connaissance des suppressions.
  const result = await pool.query(
    `
      SELECT *
      FROM child_bottle_presets
      WHERE child_id = $1
      ORDER BY capacity_ml ASC, id ASC
    `,
    [childId],
  );

  return result.rows.map(mapPreset);
}

async function createBottlePreset({ childId, userId, data }) {
  await requireChildTrackingAccess({
    childId,
    userId,
    write: true,
  });

  const preset = validatePresetData(data);

  const result = await pool.query(
    `
      INSERT INTO child_bottle_presets (
        id,
        child_id,
        label,
        capacity_ml,
        original_value,
        original_unit,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [
      preset.id,
      childId,
      preset.label,
      preset.capacityMl,
      preset.originalValue,
      preset.originalUnit,
      userId,
    ],
  );

  if (result.rowCount > 0) {
    return {
      created: true,
      preset: mapPreset(result.rows[0]),
    };
  }

  // Une création rejouée avec le même UUID ne modifie
  // ni ne réactive un preset existant.
  const existingResult = await pool.query(
    `
      SELECT *
      FROM child_bottle_presets
      WHERE id = $1
    `,
    [preset.id],
  );

  const existing = existingResult.rows[0];

  if (existing) {
    const isSameCreation =
      existing.child_id === childId.toLowerCase() &&
      existing.created_by_user_id === userId.toLowerCase() &&
      existing.label === preset.label &&
      Number(existing.capacity_ml) === preset.capacityMl &&
      Number(existing.original_value) === preset.originalValue &&
      existing.original_unit === preset.originalUnit;

    if (!isSameCreation) {
      throw createTrackingError(
        "BOTTLE_PRESET_ID_CONFLICT",
        "This bottle preset ID is already used.",
        409,
      );
    }

    return {
      created: false,
      preset: mapPreset(existing),
    };
  }

  throw createTrackingError(
    "BOTTLE_CAPACITY_ALREADY_EXISTS",
    "A bottle with this capacity already exists for this child.",
    409,
  );
}

async function archiveBottlePreset({ childId, userId, presetId }) {
  validateUuid(presetId, "bottle preset ID");

  await requireChildTrackingAccess({
    childId,
    userId,
    write: true,
  });

  const result = await pool.query(
    `
      UPDATE child_bottle_presets
      SET
        archived_at = now(),
        updated_at = clock_timestamp(),
        version = version + 1
      WHERE id = $1
        AND child_id = $2
        AND archived_at IS NULL
      RETURNING *
    `,
    [presetId, childId],
  );

  if (result.rowCount > 0) {
    return mapPreset(result.rows[0]);
  }

  // Rejouer un archivage déjà effectué reste un succès.
  const existingResult = await pool.query(
    `
      SELECT *
      FROM child_bottle_presets
      WHERE id = $1 AND child_id = $2
    `,
    [presetId, childId],
  );

  if (existingResult.rowCount === 0) {
    throw createTrackingError(
      "BOTTLE_PRESET_NOT_FOUND",
      "Bottle preset not found.",
      404,
    );
  }

  return mapPreset(existingResult.rows[0]);
}

module.exports = {
  getBottlePresets,
  createBottlePreset,
  archiveBottlePreset,
};
