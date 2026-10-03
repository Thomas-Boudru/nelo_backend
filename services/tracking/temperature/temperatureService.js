const { randomUUID } = require("node:crypto");

const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const MEASUREMENT_SITES = new Set(["forehead", "armpit", "rectal", "ear"]);

const INPUT_UNITS = new Set(["celsius", "fahrenheit"]);

const SELECT_TEMPERATURE = `
  SELECT
    t.*,
    d.temperature_celsius,
    d.measurement_site,
    d.input_value,
    d.input_unit
  FROM tracking_entries t
  INNER JOIN temperature_details d
    ON d.tracking_entry_id = t.id
`;

function mapTemperature(row) {
  const measuredAt = new Date(row.started_at).toISOString();
  const temperatureCelsius = Number(row.temperature_celsius);

  return {
    id: row.id,
    childId: row.child_id,
    type: "temperature",

    temperatureCelsius,
    inputValue: row.input_value == null ? null : Number(row.input_value),
    inputUnit: row.input_unit,
    measurementSite: row.measurement_site,

    measuredAt,
    startedAt: measuredAt,
    endedAt: null,

    // Compatibilité avec le formulaire actuel.
    temperature: temperatureCelsius,
    value: temperatureCelsius,
    unit: "celsius",
    location: row.measurement_site,
    measurementLocation: row.measurement_site,

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

function validateTemperatureData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_ENTRY",
      "Invalid temperature entry.",
      400,
    );
  }

  if (!INPUT_UNITS.has(data.inputUnit)) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_UNIT",
      "Invalid temperature unit.",
      400,
    );
  }

  if (
    typeof data.inputValue !== "number" ||
    !Number.isFinite(data.inputValue)
  ) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_VALUE",
      "A valid temperature value is required.",
      400,
    );
  }

  const inputValue = Number(data.inputValue.toFixed(2));

  // La colonne input_value conserve au maximum deux décimales.
  if (Math.abs(data.inputValue - inputValue) > 0.00000001) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_PRECISION",
      "Temperature must have at most two decimal places.",
      400,
    );
  }

  const rawCelsius =
    data.inputUnit === "fahrenheit" ? ((inputValue - 32) * 5) / 9 : inputValue;

  if (rawCelsius < 34 - 0.000001 || rawCelsius > 42 + 0.000001) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_VALUE",
      "Temperature must be between 34 and 42 degrees Celsius.",
      400,
    );
  }

  if (!MEASUREMENT_SITES.has(data.measurementSite)) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_SITE",
      "Invalid temperature measurement site.",
      400,
    );
  }

  if (
    typeof data.measuredAt !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(data.measuredAt) ||
    !Number.isFinite(Date.parse(data.measuredAt))
  ) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_DATE",
      "A valid measurement date with a timezone is required.",
      400,
    );
  }

  const measuredAt = new Date(data.measuredAt).toISOString();

  if (Date.parse(measuredAt) > Date.now()) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_DATE",
      "Measurement date cannot be in the future.",
      400,
    );
  }

  if (
    data.note != null &&
    (typeof data.note !== "string" || data.note.length > 10000)
  ) {
    throw createTrackingError(
      "INVALID_TEMPERATURE_NOTE",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  return {
    temperatureCelsius: Number(rawCelsius.toFixed(2)),
    inputValue,
    inputUnit: data.inputUnit,
    measurementSite: data.measurementSite,
    measuredAt,

    // undefined permet de conserver une note omise lors d'un PATCH.
    note: data.note === undefined ? undefined : data.note?.trim() || null,
  };
}

async function readTemperature(database, childId, entryId) {
  const result = await database.query(
    `
      ${SELECT_TEMPERATURE}
      WHERE t.id = $1
        AND t.child_id = $2
        AND t.entry_type = 'temperature'
    `,
    [entryId, childId],
  );

  return result.rows[0] ?? null;
}

function hasSameData(row, values) {
  return (
    new Date(row.started_at).toISOString() === values.measuredAt &&
    Number(row.temperature_celsius) === values.temperatureCelsius &&
    row.input_value != null &&
    Number(row.input_value) === values.inputValue &&
    row.input_unit === values.inputUnit &&
    row.measurement_site === values.measurementSite &&
    (row.note_text ?? null) === values.note
  );
}

async function getTemperatureEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  await requireChildTrackingAccess({ childId, userId });

  const row = await readTemperature(pool, childId, entryId);

  if (!row || row.deleted_at) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }

  return mapTemperature(row);
}

async function createTemperatureEntry({ childId, userId, data }) {
  const values = validateTemperatureData(data);
  values.note = values.note ?? null;

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
          ended_at,
          note_text,
          source,
          created_by_user_id
        )
        VALUES ($1, $2, 'temperature', $3, NULL, $4, 'manual', $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [entryId, childId, values.measuredAt, values.note, userId],
    );

    if (inserted.rowCount === 0) {
      const existing = await readTemperature(client, childId, entryId);

      if (
        !existing ||
        existing.created_by_user_id !== userId.toLowerCase() ||
        existing.source !== "manual" ||
        !hasSameData(existing, values)
      ) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used with different data.",
          409,
        );
      }

      // Une nouvelle tentative ne restaure pas une entrée supprimée.
      await client.query("COMMIT");

      return {
        created: false,
        entry: mapTemperature(existing),
      };
    }

    await client.query(
      `
        INSERT INTO temperature_details (
          tracking_entry_id,
          temperature_celsius,
          measurement_site,
          input_value,
          input_unit
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        entryId,
        values.temperatureCelsius,
        values.measurementSite,
        values.inputValue,
        values.inputUnit,
      ],
    );

    const row = await readTemperature(client, childId, entryId);

    await client.query("COMMIT");

    return {
      created: true,
      entry: mapTemperature(row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateTemperatureEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const values = validateTemperatureData(data);

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
        SELECT id
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'temperature'
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

    const existing = await readTemperature(client, childId, entryId);

    if (!existing) {
      throw createTrackingError(
        "TEMPERATURE_DETAILS_MISSING",
        "Temperature details are missing.",
        500,
      );
    }

    if (values.note === undefined) {
      values.note = existing.note_text ?? null;
    }

    const existingVersion = Number(existing.version);

    if (existingVersion !== data.version) {
      const isSameRetry =
        existingVersion === data.version + 1 &&
        existing.updated_by_user_id === userId.toLowerCase() &&
        hasSameData(existing, values);

      if (isSameRetry) {
        await client.query("COMMIT");
        return mapTemperature(existing);
      }

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
      [entryId, childId, values.measuredAt, values.note, userId],
    );

    const details = await client.query(
      `
        UPDATE temperature_details
        SET
          temperature_celsius = $2,
          measurement_site = $3,
          input_value = $4,
          input_unit = $5
        WHERE tracking_entry_id = $1
        RETURNING tracking_entry_id
      `,
      [
        entryId,
        values.temperatureCelsius,
        values.measurementSite,
        values.inputValue,
        values.inputUnit,
      ],
    );

    if (details.rowCount === 0) {
      throw createTrackingError(
        "TEMPERATURE_DETAILS_MISSING",
        "Temperature details are missing.",
        500,
      );
    }

    const row = await readTemperature(client, childId, entryId);

    await client.query("COMMIT");

    return mapTemperature(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getTemperatureEntry,
  createTemperatureEntry,
  updateTemperatureEntry,
};
