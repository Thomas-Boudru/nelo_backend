const { createHash, randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const { getFamilyEntitlements } = require("./familyEntitlementsService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORES = new Set(["app_store", "play_store"]);

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw serviceError("INVALID_REQUEST", `A valid ${label} is required.`, 400);
  }
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT;

  if (!["sandbox", "production"].includes(environment)) {
    throw serviceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  return environment;
}

function mapProduct(row) {
  return {
    id: row.id,
    planCode: row.plan_code,
    store: row.store,
    storeProductId: row.store_product_id,
    storeBasePlanId: row.store_base_plan_id || null,
    billingPeriod: row.billing_period,
  };
}

function mapIntent(row, product, replayed) {
  return {
    id: row.id,
    familyId: row.family_id,
    status: row.status,
    environment: row.environment,
    expiresAt: row.expires_at,
    replayed,
    product: mapProduct(product),

    appleAppAccountToken: row.payment_provider === "app_store" ? row.id : null,
  };
}

async function getSubscriptionProducts({ store }) {
  if (!STORES.has(store)) {
    throw serviceError(
      "INVALID_STORE",
      "The store must be app_store or play_store.",
      400,
    );
  }

  const result = await pool.query(
    `
      SELECT
        id,
        plan_code,
        store,
        store_product_id,
        store_base_plan_id,
        billing_period

      FROM subscription_products

      WHERE store = $1
        AND plan_code = 'premium'
        AND is_available_for_purchase = TRUE

      ORDER BY
        CASE WHEN billing_period = 'month' THEN 0 ELSE 1 END,
        id
    `,
    [store],
  );

  return result.rows.map(mapProduct);
}

async function createSubscriptionPurchaseIntent({
  familyId,
  userId,
  productId,
  idempotencyKey,
}) {
  validateUuid(familyId, "family ID");
  validateUuid(userId, "user ID");
  validateUuid(productId, "product ID");
  validateUuid(idempotencyKey, "idempotency key");

  familyId = familyId.toLowerCase();
  userId = userId.toLowerCase();
  productId = productId.toLowerCase();
  idempotencyKey = idempotencyKey.toLowerCase();

  const environment = getEnvironment();

  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        purchaseKind: "subscription",
        familyId,
        userId,
        productId,
        environment,
      }),
    )
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Sérialise les préparations d'achat d'un même utilisateur,
    // y compris lorsqu'il possède plusieurs familles.
    const user = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        FOR UPDATE
      `,
      [userId],
    );

    if (user.rowCount === 0) {
      throw serviceError(
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
        401,
      );
    }

    const family = await client.query(
      `
        SELECT f.id
        FROM families f
        WHERE f.id = $1
          AND f.deleted_at IS NULL
        FOR UPDATE
      `,
      [familyId],
    );

    const membership = await client.query(
      `
        SELECT id, family_role
        FROM family_members
        WHERE family_id = $1
          AND user_id = $2
          AND removed_at IS NULL
        ORDER BY
          CASE WHEN family_role = 'owner' THEN 0 ELSE 1 END,
          id
        LIMIT 1
        FOR UPDATE
      `,
      [familyId, userId],
    );

    if (family.rowCount === 0 || membership.rowCount === 0) {
      throw serviceError(
        "FAMILY_NOT_FOUND",
        "The family could not be found.",
        404,
      );
    }

    if (membership.rows[0].family_role !== "owner") {
      throw serviceError(
        "FAMILY_OWNER_REQUIRED",
        "Only a family owner can purchase a subscription.",
        403,
      );
    }

    const existing = await client.query(
      `
        SELECT *
        FROM subscription_purchase_intents
        WHERE idempotency_key = $1
        FOR UPDATE
      `,
      [idempotencyKey],
    );

    if (existing.rowCount > 0) {
      const intent = existing.rows[0];

      if (
        intent.purchased_by_user_id !== userId ||
        intent.request_hash !== requestHash
      ) {
        throw serviceError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key belongs to another request.",
          409,
        );
      }

      const existingProduct = await client.query(
        "SELECT * FROM subscription_products WHERE id = $1",
        [intent.product_id],
      );

      if (
        intent.status === "pending" &&
        new Date(intent.expires_at).getTime() <= Date.now()
      ) {
        await client.query(
          `
            UPDATE subscription_purchase_intents
            SET status = 'expired', updated_at = NOW()
            WHERE id = $1
          `,
          [intent.id],
        );

        intent.status = "expired";
      }

      await client.query("COMMIT");

      return mapIntent(intent, existingProduct.rows[0], true);
    }

    const productResult = await client.query(
      `
        SELECT *
        FROM subscription_products
        WHERE id = $1
          AND plan_code = 'premium'
          AND is_available_for_purchase = TRUE
        FOR SHARE
      `,
      [productId],
    );

    if (productResult.rowCount === 0) {
      throw serviceError(
        "SUBSCRIPTION_PRODUCT_NOT_AVAILABLE",
        "This subscription product is not available.",
        404,
      );
    }

    const product = productResult.rows[0];

    const entitlements = await getFamilyEntitlements({
      familyId,
      userId,
      database: client,
    });

    if (entitlements.isPremium) {
      throw serviceError(
        "FAMILY_ALREADY_PREMIUM",
        "Your family already has Premium access.",
        409,
      );
    }

    // Évite un nouvel achat lorsque l'utilisateur ou la famille
    // possède un abonnement encore actif ou récupérable.
    const existingSubscription = await client.query(
      `
        SELECT id
        FROM subscriptions
        WHERE environment = $3
          AND (
            family_id = $1
            OR purchased_by_user_id = $2
          )
          AND revoked_at IS NULL
          AND (
            (
              status IN ('active', 'grace_period', 'cancelled')
              AND access_expires_at > NOW()
            )
            OR status IN ('pending', 'on_hold', 'paused')
          )
        LIMIT 1
      `,
      [familyId, userId, environment],
    );

    if (existingSubscription.rowCount > 0) {
      throw serviceError(
        "EXISTING_SUBSCRIPTION_REQUIRES_REVIEW",
        "An existing subscription must be managed or restored before a new purchase.",
        409,
      );
    }

    // Une intention expirée est conservée pour le rapprochement
    // d'une éventuelle confirmation tardive du store.
    await client.query(
      `
        UPDATE subscription_purchase_intents
        SET status = 'expired', updated_at = NOW()
        WHERE environment = $3
          AND purchase_kind = 'subscription'
          AND (
            family_id = $1
            OR purchased_by_user_id = $2
          )
          AND status = 'pending'
          AND expires_at <= NOW()
      `,
      [familyId, userId, environment],
    );

    const pending = await client.query(
      `
        SELECT id
        FROM subscription_purchase_intents
        WHERE environment = $3
          AND purchase_kind = 'subscription'
          AND (
            family_id = $1
            OR purchased_by_user_id = $2
          )
          AND status IN ('pending', 'processing')
        LIMIT 1
      `,
      [familyId, userId, environment],
    );

    if (pending.rowCount > 0) {
      throw serviceError(
        "SUBSCRIPTION_PURCHASE_IN_PROGRESS",
        "A subscription purchase is already in progress.",
        409,
      );
    }

    const result = await client.query(
      `
        INSERT INTO subscription_purchase_intents (
          id,
          purchased_by_user_id,
          family_id,
          product_id,
          purchase_kind,
          payment_provider,
          environment,
          idempotency_key,
          request_hash,
          expires_at
        )
        VALUES (
          $1, $2, $3, $4,
          'subscription',
          $5, $6, $7, $8,
          NOW() + INTERVAL '30 minutes'
        )
        RETURNING *
      `,
      [
        randomUUID(),
        userId,
        familyId,
        productId,
        product.store,
        environment,
        idempotencyKey,
        requestHash,
      ],
    );

    await client.query("COMMIT");

    return mapIntent(result.rows[0], product, false);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to rollback purchase intent:", rollbackError);
    }

    if (
      error.code === "23505" &&
      error.constraint === "subscription_purchase_intents_idempotency_key_key"
    ) {
      throw serviceError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "This idempotency key belongs to another request.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getSubscriptionProducts,
  createSubscriptionPurchaseIntent,
};
