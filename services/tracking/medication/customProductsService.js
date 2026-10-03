const { randomUUID } = require("node:crypto");
const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const DOSE_UNITS = new Set(["ml", "drops", "tablet", "suppository", "dose"]);

// Les noms de tables viennent uniquement de cette configuration.
const PRODUCT_TYPES = {
  medication: {
    table: "child_custom_medications",
    uniqueNameIndex: "idx_custom_medications_active_name",
  },
  vaccine: {
    table: "child_custom_vaccines",
    uniqueNameIndex: "idx_custom_vaccines_active_name",
  },
};

function getConfiguration(type) {
  if (!Object.hasOwn(PRODUCT_TYPES, type)) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT_TYPE",
      "Invalid custom product type.",
      400,
    );
  }

  return PRODUCT_TYPES[type];
}

function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function validateProductData(data, type) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT",
      "Invalid custom product.",
      400,
    );
  }

  if (typeof data.name !== "string") {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT_NAME",
      "A product name is required.",
      400,
    );
  }

  const name = data.name.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeName(name);

  if (
    name.length < 1 ||
    name.length > 150 ||
    normalizedName.length < 1 ||
    normalizedName.length > 150
  ) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT_NAME",
      "The name must contain between 1 and 150 characters.",
      400,
    );
  }

  const defaultDoseUnit = data.defaultDoseUnit ?? null;

  if (type === "medication") {
    if (defaultDoseUnit !== null && !DOSE_UNITS.has(defaultDoseUnit)) {
      throw createTrackingError(
        "INVALID_MEDICATION_UNIT",
        "Invalid medication unit.",
        400,
      );
    }
  } else if (defaultDoseUnit !== null) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT",
      "A vaccine cannot have a default medication unit.",
      400,
    );
  }

  return {
    name,
    normalizedName,
    defaultDoseUnit,
  };
}

function mapProduct(row, type) {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    normalizedName: row.normalized_name,
    type,
    isCustom: true,
    translationKey: null,
    category: null,

    ...(type === "medication"
      ? { defaultDoseUnit: row.default_dose_unit }
      : {}),

    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    version: row.version,
  };
}

async function readProduct(database, table, childId, productId) {
  const result = await database.query(
    `
      SELECT *
      FROM ${table}
      WHERE id = $1 AND child_id = $2
    `,
    [productId, childId],
  );

  return result.rows[0] ?? null;
}

async function getCustomProducts({ childId, userId, type }) {
  const { table } = getConfiguration(type);

  await requireChildTrackingAccess({ childId, userId });

  const result = await pool.query(
    `
      SELECT *
      FROM ${table}
      WHERE child_id = $1
      ORDER BY updated_at ASC, id ASC
    `,
    [childId],
  );

  // Inclure les produits archivés permet au front
  // de retirer également ces produits de son cache local.
  return result.rows.map((row) => mapProduct(row, type));
}

async function createCustomProduct({ childId, userId, type, data }) {
  const configuration = getConfiguration(type);
  const values = validateProductData(data, type);
  const productId = data.id ?? randomUUID();

  validateUuid(productId, "custom product ID");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const parameters = [
      productId,
      childId,
      values.name,
      values.normalizedName,
      userId,
    ];

    const extraColumn = type === "medication" ? ", default_dose_unit" : "";

    const extraValue = type === "medication" ? ", $6" : "";

    if (type === "medication") {
      parameters.push(values.defaultDoseUnit);
    }

    const inserted = await client.query(
      `
        INSERT INTO ${configuration.table} (
          id,
          child_id,
          name,
          normalized_name,
          created_by_user_id
          ${extraColumn}
        )
        VALUES ($1, $2, $3, $4, $5 ${extraValue})
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `,
      parameters,
    );

    if (inserted.rowCount === 0) {
      const existing = await readProduct(
        client,
        configuration.table,
        childId,
        productId,
      );

      const sameData =
        existing &&
        existing.created_by_user_id === userId.toLowerCase() &&
        existing.name === values.name &&
        existing.normalized_name === values.normalizedName &&
        (type !== "medication" ||
          existing.default_dose_unit === values.defaultDoseUnit);

      if (!sameData) {
        throw createTrackingError(
          "CUSTOM_PRODUCT_ID_CONFLICT",
          "This product ID is already used or has different data.",
          409,
        );
      }

      await client.query("COMMIT");

      return {
        created: false,
        product: mapProduct(existing, type),
      };
    }

    await client.query("COMMIT");

    return {
      created: true,
      product: mapProduct(inserted.rows[0], type),
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      error.code === "23505" &&
      error.constraint === configuration.uniqueNameIndex
    ) {
      throw createTrackingError(
        "CUSTOM_PRODUCT_NAME_CONFLICT",
        "A custom product with this name already exists for this child.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateCustomProduct({ childId, userId, type, productId, data }) {
  const configuration = getConfiguration(type);

  validateUuid(productId, "custom product ID");

  const values = validateProductData(data, type);

  if (!Number.isInteger(data.version) || data.version < 1) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT_VERSION",
      "A valid product version is required.",
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
        SELECT *
        FROM ${configuration.table}
        WHERE id = $1 AND child_id = $2
        FOR UPDATE
      `,
      [productId, childId],
    );

    const existing = locked.rows[0];

    if (!existing || existing.archived_at) {
      throw createTrackingError(
        "CUSTOM_PRODUCT_NOT_FOUND",
        "Custom product not found.",
        404,
      );
    }

    const sameData =
      existing.name === values.name &&
      existing.normalized_name === values.normalizedName &&
      (type !== "medication" ||
        existing.default_dose_unit === values.defaultDoseUnit);

    // Réponse perdue puis demande rejouée :
    // accepter uniquement l'état attendu après cette modification.
    if (existing.version !== data.version) {
      const isReplay =
        existing.version === data.version + 1 &&
        existing.updated_by_user_id === userId.toLowerCase() &&
        sameData;

      if (!isReplay) {
        throw createTrackingError(
          "CUSTOM_PRODUCT_VERSION_CONFLICT",
          "This product was modified. Reload it before saving.",
          409,
        );
      }

      await client.query("COMMIT");

      return mapProduct(existing, type);
    }

    const parameters = [
      productId,
      childId,
      values.name,
      values.normalizedName,
      userId,
    ];

    const extraUpdate = type === "medication" ? ", default_dose_unit = $6" : "";

    if (type === "medication") {
      parameters.push(values.defaultDoseUnit);
    }

    const updated = await client.query(
      `
        UPDATE ${configuration.table}
        SET
          name = $3,
          normalized_name = $4,
          updated_by_user_id = $5,
          updated_at = clock_timestamp(),
          version = version + 1
          ${extraUpdate}
        WHERE id = $1 AND child_id = $2
        RETURNING *
      `,
      parameters,
    );

    await client.query("COMMIT");

    return mapProduct(updated.rows[0], type);
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      error.code === "23505" &&
      error.constraint === configuration.uniqueNameIndex
    ) {
      throw createTrackingError(
        "CUSTOM_PRODUCT_NAME_CONFLICT",
        "A custom product with this name already exists for this child.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function archiveCustomProduct({
  childId,
  userId,
  type,
  productId,
  version,
}) {
  const { table } = getConfiguration(type);

  validateUuid(productId, "custom product ID");

  if (!Number.isInteger(version) || version < 1) {
    throw createTrackingError(
      "INVALID_CUSTOM_PRODUCT_VERSION",
      "A valid product version is required.",
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
        SELECT *
        FROM ${table}
        WHERE id = $1 AND child_id = $2
        FOR UPDATE
      `,
      [productId, childId],
    );

    const existing = locked.rows[0];

    if (!existing) {
      throw createTrackingError(
        "CUSTOM_PRODUCT_NOT_FOUND",
        "Custom product not found.",
        404,
      );
    }

    // Un archivage rejoué ne modifie pas à nouveau la version.
    if (existing.archived_at) {
      await client.query("COMMIT");

      return mapProduct(existing, type);
    }

    if (existing.version !== version) {
      throw createTrackingError(
        "CUSTOM_PRODUCT_VERSION_CONFLICT",
        "This product was modified. Reload it before archiving.",
        409,
      );
    }

    const archived = await client.query(
      `
        UPDATE ${table}
        SET
          archived_at = clock_timestamp(),
          updated_by_user_id = $3,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1 AND child_id = $2
        RETURNING *
      `,
      [productId, childId, userId],
    );

    await client.query("COMMIT");

    return mapProduct(archived.rows[0], type);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCustomProducts,
  createCustomProduct,
  updateCustomProduct,
  archiveCustomProduct,
};
