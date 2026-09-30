const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const ML_PER_US_FL_OZ = 29.5735295625;

function roundToThreeDecimals(value) {
  return Math.round(value * 1000) / 1000;
}

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

function validateData(data) {
  if (!data || typeof data !== "object") {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET",
      "Bottle preset data is required.",
      400,
    );
  }

  if (!Number.isInteger(data.version) || data.version < 1) {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET_VERSION",
      "A valid bottle preset version is required.",
      400,
    );
  }

  if (!["ml", "fl_oz"].includes(data.originalUnit)) {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET_UNIT",
      "The bottle capacity unit is invalid.",
      400,
    );
  }

  if (
    typeof data.originalValue !== "number" ||
    !Number.isFinite(data.originalValue) ||
    data.originalValue <= 0 ||
    data.originalValue > 99999.999
  ) {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET_CAPACITY",
      "The bottle capacity is invalid.",
      400,
    );
  }

  const originalValue = roundToThreeDecimals(data.originalValue);

  const capacityMl = roundToThreeDecimals(
    data.originalUnit === "fl_oz"
      ? originalValue * ML_PER_US_FL_OZ
      : originalValue,
  );

  if (originalValue <= 0 || capacityMl <= 0 || capacityMl > 99999.999) {
    throw createTrackingError(
      "INVALID_BOTTLE_PRESET_CAPACITY",
      "The bottle capacity is invalid.",
      400,
    );
  }

  let label = null;

  if (data.label !== undefined && data.label !== null) {
    if (typeof data.label !== "string") {
      throw createTrackingError(
        "INVALID_BOTTLE_PRESET_LABEL",
        "The bottle label is invalid.",
        400,
      );
    }

    label = data.label.trim() || null;

    if (label && label.length > 80) {
      throw createTrackingError(
        "INVALID_BOTTLE_PRESET_LABEL",
        "The bottle label is too long.",
        400,
      );
    }
  }

  return {
    version: data.version,
    label,
    originalValue,
    originalUnit: data.originalUnit,
    capacityMl,
  };
}

async function updateBottlePreset({ userId, childId, presetId, data }) {
  validateUuid(presetId);

  const values = validateData(data);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      userId,
      childId,
      write: true,
      database: client,
    });

    const existingResult = await client.query(
      `
        SELECT *
        FROM child_bottle_presets
        WHERE id = $1
          AND child_id = $2
        FOR UPDATE
      `,
      [presetId, childId],
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw createTrackingError(
        "BOTTLE_PRESET_NOT_FOUND",
        "Bottle preset not found.",
        404,
      );
    }

    if (existing.archived_at) {
      throw createTrackingError(
        "BOTTLE_PRESET_ARCHIVED",
        "This bottle preset has been archived.",
        409,
      );
    }

    const matchesRequestedValues =
      Number(existing.capacity_ml) === values.capacityMl &&
      Number(existing.original_value) === values.originalValue &&
      existing.original_unit === values.originalUnit &&
      existing.label === values.label;

    // Une réponse perdue peut provoquer le renvoi de la même
    // modification. Si les valeurs sont déjà présentes,
    // retourner la version actuelle sans la modifier.
    if (matchesRequestedValues) {
      await client.query("COMMIT");
      return mapPreset(existing);
    }

    if (existing.version !== values.version) {
      throw createTrackingError(
        "BOTTLE_PRESET_VERSION_CONFLICT",
        "This bottle preset has changed. Refresh it before editing.",
        409,
      );
    }

    const result = await client.query(
      `
        UPDATE child_bottle_presets
        SET label = $3,
            capacity_ml = $4,
            original_value = $5,
            original_unit = $6,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = $1
          AND child_id = $2
        RETURNING *
      `,
      [
        presetId,
        childId,
        values.label,
        values.capacityMl,
        values.originalValue,
        values.originalUnit,
      ],
    );

    await client.query("COMMIT");

    return mapPreset(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      throw createTrackingError(
        "BOTTLE_PRESET_CAPACITY_EXISTS",
        "This bottle capacity already exists.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  updateBottlePreset,
};
