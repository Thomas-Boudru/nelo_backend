const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const SELECT_GROWTH = `
  SELECT
    t.*,
    to_char(g.measurement_date, 'YYYY-MM-DD') AS measurement_date_text,
    g.weight_g,
    g.height_mm,
    g.head_circumference_mm
  FROM tracking_entries t
  INNER JOIN growth_details g
    ON g.tracking_entry_id = t.id
`;

function toIso(value) {
  return value == null ? null : new Date(value).toISOString();
}

function fromStorage(value, factor) {
  return value == null ? null : Number(value) / factor;
}

function mapGrowth(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: "growth",

    measurementDate: row.measurement_date_text,

    weightKg: fromStorage(row.weight_g, 1000),
    heightCm: fromStorage(row.height_mm, 10),
    headCircumferenceCm: fromStorage(row.head_circumference_mm, 10),

    startedAt: toIso(row.started_at),
    endedAt: null,

    note: row.note_text ?? "",
    source: row.source,

    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,

    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at),

    version: row.version,
  };
}

function validateMeasurementDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  ) {
    throw createTrackingError(
      "INVALID_GROWTH_DATE",
      "A valid measurement date is required.",
      400,
    );
  }

  const date = new Date(`${value}T12:00:00.000Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createTrackingError(
      "INVALID_GROWTH_DATE",
      "A valid measurement date is required.",
      400,
    );
  }

  return value;
}

function normalizeMeasurement(value, field, factor, maxStorageValue) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw createTrackingError(
      "INVALID_GROWTH_MEASUREMENT",
      `A positive numeric value is required for ${field}.`,
      400,
    );
  }

  const converted = value * factor;

  if (!Number.isFinite(converted) || converted > maxStorageValue) {
    throw createTrackingError(
      "INVALID_GROWTH_MEASUREMENT",
      `The value for ${field} exceeds the storage capacity.`,
      400,
    );
  }

  // Même précision que les colonnes NUMERIC(..., 3).
  const normalized = Number(converted.toFixed(3));

  if (normalized <= 0 || normalized > maxStorageValue) {
    throw createTrackingError(
      "INVALID_GROWTH_MEASUREMENT",
      `The value for ${field} cannot be stored.`,
      400,
    );
  }

  return normalized;
}

function validateGrowthData(data, { partial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_GROWTH_ENTRY",
      "Invalid growth entry.",
      400,
    );
  }

  const measurementFields = ["weightKg", "heightCm", "headCircumferenceCm"];

  const hasOwn = (field) => Object.prototype.hasOwnProperty.call(data, field);

  if (
    partial &&
    !["measurementDate", ...measurementFields, "note"].some(hasOwn)
  ) {
    throw createTrackingError(
      "INVALID_GROWTH_ENTRY",
      "At least one field must be provided.",
      400,
    );
  }

  const values = {};

  if (!partial || hasOwn("measurementDate")) {
    values.measurementDate = validateMeasurementDate(data.measurementDate);
  }

  if (!partial || hasOwn("weightKg")) {
    values.weightG = normalizeMeasurement(
      data.weightKg,
      "weightKg",
      1000,
      999999999.999,
    );
  }

  if (!partial || hasOwn("heightCm")) {
    values.heightMm = normalizeMeasurement(
      data.heightCm,
      "heightCm",
      10,
      9999999.999,
    );
  }

  if (!partial || hasOwn("headCircumferenceCm")) {
    values.headCircumferenceMm = normalizeMeasurement(
      data.headCircumferenceCm,
      "headCircumferenceCm",
      10,
      9999999.999,
    );
  }

  if (!partial || hasOwn("note")) {
    if (
      data.note != null &&
      (typeof data.note !== "string" || data.note.length > 10000)
    ) {
      throw createTrackingError(
        "INVALID_GROWTH_NOTE",
        "The note must not exceed 10000 characters.",
        400,
      );
    }

    values.note = data.note?.trim() || null;
  }

  if (!partial) {
    ensureHasMeasurement(values);
  }

  return values;
}

function ensureHasMeasurement(values) {
  if (
    values.weightG == null &&
    values.heightMm == null &&
    values.headCircumferenceMm == null
  ) {
    throw createTrackingError(
      "GROWTH_MEASUREMENT_REQUIRED",
      "At least one growth measurement is required.",
      400,
    );
  }
}

function getStoredValues(row) {
  return {
    measurementDate: row.measurement_date_text,
    weightG: row.weight_g == null ? null : Number(row.weight_g),
    heightMm: row.height_mm == null ? null : Number(row.height_mm),
    headCircumferenceMm:
      row.head_circumference_mm == null
        ? null
        : Number(row.head_circumference_mm),
    note: row.note_text ?? null,
  };
}

function hasSameData(row, values) {
  const existing = getStoredValues(row);

  return (
    existing.measurementDate === values.measurementDate &&
    existing.weightG === values.weightG &&
    existing.heightMm === values.heightMm &&
    existing.headCircumferenceMm === values.headCircumferenceMm &&
    existing.note === values.note
  );
}

async function readGrowth(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_GROWTH}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'growth'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

async function getGrowthEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readGrowth(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapGrowth(row);
}

async function createGrowthEntry({ childId, userId, data }) {
  const values = validateGrowthData(data);

  const entryId = data.id ?? randomUUID();

  validateUuid(entryId, "tracking entry ID");

  const startedAt = `${values.measurementDate}T12:00:00.000Z`;

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
          ended_at,
          note_text,
          source,
          created_by_user_id
        )
        VALUES (
          $1, $2, 'growth', $3, NULL, $4, 'manual', $5
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, startedAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readGrowth(client, childId, entryId);

      if (
        !existing ||
        existing.created_by_user_id !== userId.toLowerCase() ||
        existing.source !== "manual" ||
        !hasSameData(existing, values)
      ) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "An entry with this ID already has different data.",
          409,
        );
      }

      // Une répétition ne recrée jamais une entrée supprimée.
      await client.query("COMMIT");

      return {
        created: false,
        entry: mapGrowth(existing),
      };
    }

    await client.query(
      `
        INSERT INTO growth_details (
          tracking_entry_id,
          measurement_date,
          weight_g,
          height_mm,
          head_circumference_mm
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        entryId,
        values.measurementDate,
        values.weightG,
        values.heightMm,
        values.headCircumferenceMm,
      ],
    );

    const row = await readGrowth(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapGrowth(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateGrowthEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const changes = validateGrowthData(data, { partial: true });

  if (!Number.isSafeInteger(data.version) || data.version < 1) {
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
        SELECT id
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'growth'
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

    const existing = await readGrowth(client, childId, entryId);

    if (!existing) {
      throw createTrackingError(
        "GROWTH_DETAILS_MISSING",
        "Growth details are missing.",
        500,
      );
    }

    // Champ omis : conserver sa valeur.
    // Champ explicitement null : retirer cette mesure.
    const values = {
      ...getStoredValues(existing),
      ...changes,
    };

    ensureHasMeasurement(values);

    if (existing.version !== data.version) {
      const isImmediateRetry =
        existing.version === data.version + 1 &&
        existing.updated_by_user_id === userId.toLowerCase() &&
        hasSameData(existing, values);

      if (!isImmediateRetry) {
        throw createTrackingError(
          "TRACKING_VERSION_CONFLICT",
          "This entry was modified. Reload it before saving.",
          409,
        );
      }

      await client.query("COMMIT");

      return mapGrowth(existing);
    }

    const startedAt = `${values.measurementDate}T12:00:00.000Z`;

    await client.query(
      `
        UPDATE tracking_entries
        SET started_at = $3,
            note_text = $4,
            updated_by_user_id = $5,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = $1
          AND child_id = $2
      `,
      [entryId, childId, startedAt, values.note, userId],
    );

    await client.query(
      `
        UPDATE growth_details
        SET measurement_date = $2,
            weight_g = $3,
            height_mm = $4,
            head_circumference_mm = $5
        WHERE tracking_entry_id = $1
      `,
      [
        entryId,
        values.measurementDate,
        values.weightG,
        values.heightMm,
        values.headCircumferenceMm,
      ],
    );

    const updated = await readGrowth(client, childId, entryId);

    await client.query("COMMIT");

    return mapGrowth(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getLatestGrowthMeasurements({
  childId,
  userId,
  onOrBefore,
  excludeEntryId,
}) {
  const cutoff =
    onOrBefore === undefined ? null : validateMeasurementDate(onOrBefore);

  if (excludeEntryId !== undefined) {
    validateUuid(excludeEntryId, "tracking entry ID");
  }

  await requireChildTrackingAccess({ childId, userId });

  /*
   * Une seule requête pour obtenir une vue cohérente.
   * Chaque mesure peut provenir d'une entrée différente.
   */
  const result = await pool.query(
    `
      WITH candidates AS (
        SELECT
          t.id,
          t.created_at,
          g.measurement_date,
          g.weight_g,
          g.height_mm,
          g.head_circumference_mm
        FROM tracking_entries t
        INNER JOIN growth_details g
          ON g.tracking_entry_id = t.id
        WHERE t.child_id = $1
          AND t.entry_type = 'growth'
          AND t.deleted_at IS NULL
          AND (
            $2::date IS NULL
            OR g.measurement_date <= $2::date
          )
          AND (
            $3::uuid IS NULL
            OR t.id <> $3::uuid
          )
      ),
      measurements AS (
        SELECT
          c.id,
          c.created_at,
          c.measurement_date,
          v.kind,
          v.value
        FROM candidates c
        CROSS JOIN LATERAL (
          VALUES
            ('weight', c.weight_g),
            ('height', c.height_mm),
            ('headCircumference', c.head_circumference_mm)
        ) AS v(kind, value)
        WHERE v.value IS NOT NULL
      )
      SELECT DISTINCT ON (kind)
        kind,
        value,
        id,
        to_char(measurement_date, 'YYYY-MM-DD')
          AS measurement_date_text
      FROM measurements
      ORDER BY
        kind,
        measurement_date DESC,
        created_at DESC,
        id DESC
    `,
    [childId, cutoff, excludeEntryId ?? null],
  );

  const measurements = {
    weight: null,
    height: null,
    headCircumference: null,
  };

  for (const row of result.rows) {
    const factor = row.kind === "weight" ? 1000 : 10;

    measurements[row.kind] = {
      value: Number(row.value) / factor,
      unit: row.kind === "weight" ? "kg" : "cm",
      measurementDate: row.measurement_date_text,
      entryId: row.id,
    };
  }

  return measurements;
}

module.exports = {
  getGrowthEntry,
  createGrowthEntry,
  updateGrowthEntry,
  getLatestGrowthMeasurements,
};
