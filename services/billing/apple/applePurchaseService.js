const pool = require("../../../db/pool");

const { getAppleBillingConnection } = require("./appleBillingClient");

const {
  getVerifiedAppleTransaction,
  getVerifiedAppleSubscriptionStatuses,
} = require("./appleVerificationService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function appleDate(value, required = false) {
  if (value === undefined || value === null) {
    if (required) {
      throw serviceError(
        "APPLE_DATE_MISSING",
        "Apple returned incomplete subscription dates.",
        502,
      );
    }

    return null;
  }

  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw serviceError(
      "INVALID_APPLE_DATE",
      "Apple returned an invalid subscription date.",
      502,
    );
  }

  return new Date(value);
}

function checkTransaction(transaction, intent, bundleId) {
  const expectedEnvironment =
    intent.environment === "production" ? "Production" : "Sandbox";

  if (
    transaction.bundleId !== bundleId ||
    transaction.environment !== expectedEnvironment ||
    transaction.type !== "Auto-Renewable Subscription" ||
    transaction.inAppOwnershipType !== "PURCHASED"
  ) {
    throw serviceError(
      "APPLE_PURCHASE_NOT_SUPPORTED",
      "This Apple purchase is not valid for this subscription.",
      409,
    );
  }

  if (
    typeof transaction.appAccountToken !== "string" ||
    transaction.appAccountToken.toLowerCase() !== intent.id
  ) {
    throw serviceError(
      "APPLE_PURCHASE_ACCOUNT_MISMATCH",
      "This Apple purchase does not match the prepared purchase.",
      409,
    );
  }

  if (!transaction.transactionId || !transaction.originalTransactionId) {
    throw serviceError(
      "APPLE_TRANSACTION_INCOMPLETE",
      "Apple returned incomplete transaction information.",
      502,
    );
  }
}

function getSubscriptionState(item) {
  const { transaction, renewal } = item;

  const periodStart = appleDate(transaction.purchaseDate, true);
  const periodEnd = appleDate(transaction.expiresDate, true);
  const revokedAt = appleDate(transaction.revocationDate);

  if (periodEnd <= periodStart) {
    throw serviceError(
      "INVALID_APPLE_PERIOD",
      "Apple returned an invalid subscription period.",
      502,
    );
  }

  if (![0, 1].includes(renewal.autoRenewStatus)) {
    throw serviceError(
      "INVALID_APPLE_RENEWAL_STATUS",
      "Apple returned an invalid renewal status.",
      502,
    );
  }

  if (![1, 2, 3, 4, 5].includes(item.status)) {
    throw serviceError(
      "INVALID_APPLE_SUBSCRIPTION_STATUS",
      "Apple returned an unsupported subscription status.",
      502,
    );
  }

  const autoRenewEnabled = renewal.autoRenewStatus === 1;

  let status;
  let accessExpiresAt = null;
  let gracePeriodEndsAt = null;

  if (revokedAt || item.status === 5) {
    status = "revoked";
  } else {
    switch (item.status) {
      case 1:
        status = autoRenewEnabled ? "active" : "cancelled";
        accessExpiresAt = periodEnd;
        break;

      case 2:
        status = "expired";
        break;

      case 3:
        // Relance du paiement sans période de grâce active.
        status = "on_hold";
        break;

      case 4:
        status = "grace_period";
        gracePeriodEndsAt = appleDate(renewal.gracePeriodExpiresDate, true);
        accessExpiresAt = gracePeriodEndsAt;
        break;
    }
  }

  return {
    status,
    periodStart,
    periodEnd,
    accessExpiresAt,
    gracePeriodEndsAt,
    autoRenewEnabled,
    revokedAt,
  };
}

async function verifyAppleCall(callback) {
  try {
    return await callback();
  } catch (error) {
    // Préserve nos erreurs explicites, sans exposer les réponses
    // brutes du fournisseur ou leurs données sensibles.
    if (typeof error.code === "string" && error.status) {
      throw error;
    }

    throw serviceError(
      "APPLE_VERIFICATION_UNAVAILABLE",
      "The purchase could not be verified with Apple. Please try again.",
      503,
    );
  }
}

async function saveTransaction(
  client,
  { transaction, subscriptionId, intentId, environment },
) {
  const revokedAt = appleDate(transaction.revocationDate);

  const result = await client.query(
    `
      INSERT INTO subscription_transactions AS existing (
        subscription_id,
        purchase_intent_id,
        payment_provider,
        environment,
        provider_transaction_id,
        transaction_kind,
        status,
        purchased_at,
        period_starts_at,
        period_ends_at,
        revoked_at,
        verified_at
      )
      VALUES (
        $1, $2, 'app_store', $3, $4, $5, $6,
        $7, $7, $8, $9, clock_timestamp()
      )

      ON CONFLICT (
        payment_provider,
        environment,
        provider_transaction_id
      )
      DO UPDATE SET
        status = CASE
          WHEN EXCLUDED.revoked_at IS NOT NULL THEN 'revoked'
          ELSE existing.status
        END,
        revoked_at = COALESCE(
          EXCLUDED.revoked_at,
          existing.revoked_at
        ),
        verified_at = clock_timestamp(),
        updated_at = clock_timestamp()

      WHERE existing.subscription_id = EXCLUDED.subscription_id

      RETURNING id
    `,
    [
      subscriptionId,
      intentId,
      environment,
      transaction.transactionId,
      transaction.transactionId === transaction.originalTransactionId
        ? "initial_purchase"
        : "renewal",
      revokedAt ? "revoked" : "paid",
      appleDate(transaction.purchaseDate, true),
      appleDate(transaction.expiresDate, true),
      revokedAt,
    ],
  );

  if (result.rowCount === 0) {
    throw serviceError(
      "APPLE_TRANSACTION_ALREADY_LINKED",
      "This transaction is already linked to another subscription.",
      409,
    );
  }
}

async function synchronizeApplePurchase({
  userId,
  purchaseIntentId,
  transactionId,
  fromNotification = false,
}) {
  validateUuid(userId, "user ID");
  validateUuid(purchaseIntentId, "purchase intent ID");

  if (
    typeof transactionId !== "string" ||
    !/^[0-9]{1,64}$/.test(transactionId)
  ) {
    throw serviceError(
      "INVALID_APPLE_TRANSACTION_ID",
      "A valid Apple transaction ID is required.",
      400,
    );
  }

  userId = userId.toLowerCase();
  purchaseIntentId = purchaseIntentId.toLowerCase();

  const { billingEnvironment, bundleId } = getAppleBillingConnection();

  // Vérifie les permissions avant de contacter Apple.
  const initialIntent = await pool.query(
    `
      SELECT pi.*, p.store_product_id

      FROM subscription_purchase_intents pi
      JOIN subscription_products p ON p.id = pi.product_id
      JOIN families f ON f.id = pi.family_id
      JOIN users u ON u.id = pi.purchased_by_user_id

      WHERE pi.id = $1
        AND pi.purchased_by_user_id = $2
        AND pi.purchase_kind = 'subscription'
        AND pi.payment_provider = 'app_store'
        AND p.store = 'app_store'
        AND pi.environment = $3

        AND (
          $4::boolean
          OR (
            f.deleted_at IS NULL
            AND u.deleted_at IS NULL
            AND u.status = 'active'

            AND EXISTS (
              SELECT 1
              FROM family_members fm
              WHERE fm.family_id = f.id
                AND fm.user_id = $2
                AND fm.family_role = 'owner'
                AND fm.removed_at IS NULL
            )
          )
        )
    `,
    [purchaseIntentId, userId, billingEnvironment, fromNotification],
  );

  if (initialIntent.rowCount === 0) {
    throw serviceError(
      "PURCHASE_INTENT_NOT_FOUND",
      "The prepared purchase could not be found.",
      404,
    );
  }

  const intent = initialIntent.rows[0];

  const purchasedTransaction = await verifyAppleCall(() =>
    getVerifiedAppleTransaction({ transactionId }),
  );

  checkTransaction(purchasedTransaction, intent, bundleId);

  if (
    !fromNotification &&
    purchasedTransaction.productId !== intent.store_product_id
  ) {
    throw serviceError(
      "APPLE_PRODUCT_MISMATCH",
      "The purchased product does not match the prepared purchase.",
      409,
    );
  }

  const originalTransactionId = purchasedTransaction.originalTransactionId;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Sérialise la lecture de l'état Apple et sa sauvegarde
    // pour une même chaîne d'abonnement.
    // Les futurs traitements de notifications utiliseront
    // exactement la même clé de verrouillage.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`apple-subscription:${billingEnvironment}:${originalTransactionId}`],
    );

    const statuses = await verifyAppleCall(() =>
      getVerifiedAppleSubscriptionStatuses({
        transactionId: originalTransactionId,
      }),
    );

    const matching = statuses.filter(
      (item) =>
        item.transaction.originalTransactionId === originalTransactionId,
    );

    if (matching.length !== 1) {
      throw serviceError(
        "APPLE_SUBSCRIPTION_STATE_UNAVAILABLE",
        "The current Apple subscription state could not be determined.",
        502,
      );
    }

    const current = matching[0];
    checkTransaction(current.transaction, intent, bundleId);

    const state = getSubscriptionState(current);

    // Conserve le même ordre de verrouillage que les achats.
    const user = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND (
            $2::boolean
            OR (
              deleted_at IS NULL
              AND status = 'active'
            )
          )
        FOR UPDATE
      `,
      [userId, fromNotification],
    );

    const family = await client.query(
      `
        SELECT id
        FROM families
        WHERE id = $1
          AND ($2::boolean OR deleted_at IS NULL)
        FOR UPDATE
      `,
      [intent.family_id, fromNotification],
    );

    if (user.rowCount === 0 || family.rowCount === 0) {
      throw serviceError(
        "FAMILY_ACCESS_CHANGED",
        "The account or family is no longer available.",
        403,
      );
    }

    if (!fromNotification) {
      const member = await client.query(
        `
          SELECT id
          FROM family_members
          WHERE family_id = $1
            AND user_id = $2
            AND family_role = 'owner'
            AND removed_at IS NULL
          FOR UPDATE
        `,
        [intent.family_id, userId],
      );

      if (member.rowCount === 0) {
        throw serviceError(
          "FAMILY_ACCESS_CHANGED",
          "Your access to this family has changed.",
          403,
        );
      }
    }

    const lockedIntent = await client.query(
      `
        SELECT * FROM subscription_purchase_intents
        WHERE id = $1
        FOR UPDATE
      `,
      [intent.id],
    );

    const savedIntent = lockedIntent.rows[0];

    if (
      !savedIntent ||
      savedIntent.family_id !== intent.family_id ||
      savedIntent.purchased_by_user_id !== userId ||
      savedIntent.product_id !== intent.product_id ||
      savedIntent.environment !== billingEnvironment ||
      savedIntent.purchase_kind !== "subscription" ||
      savedIntent.payment_provider !== "app_store"
    ) {
      throw serviceError(
        "PURCHASE_INTENT_CHANGED",
        "The prepared purchase no longer matches this purchase.",
        409,
      );
    }

    // Un produit retiré de la vente reste vérifiable pour
    // les achats déjà payés et les abonnements existants.
    const product = await client.query(
      `
        SELECT id FROM subscription_products
        WHERE store = 'app_store'
          AND store_product_id = $1
          AND store_base_plan_id = ''
          AND plan_code = 'premium'
      `,
      [current.transaction.productId],
    );

    if (product.rowCount === 0) {
      throw serviceError(
        "APPLE_PRODUCT_NOT_CONFIGURED",
        "The Apple subscription product is not configured.",
        409,
      );
    }

    const subscription = await client.query(
      `
        INSERT INTO subscriptions AS existing (
          family_id,
          purchased_by_user_id,
          product_id,
          store,
          environment,
          store_subscription_id,
          status,
          current_period_start,
          current_period_end,
          access_expires_at,
          grace_period_ends_at,
          auto_renew_enabled,
          revoked_at,
          last_verified_at
        )
        VALUES (
          $1, $2, $3, 'app_store', $4, $5,
          $6, $7, $8, $9, $10, $11, $12,
          clock_timestamp()
        )

        ON CONFLICT (
          store,
          environment,
          store_subscription_id
        )
        DO UPDATE SET
          product_id = EXCLUDED.product_id,
          status = EXCLUDED.status,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          access_expires_at = EXCLUDED.access_expires_at,
          grace_period_ends_at = EXCLUDED.grace_period_ends_at,
          auto_renew_enabled = EXCLUDED.auto_renew_enabled,
          revoked_at = EXCLUDED.revoked_at,
          last_verified_at = clock_timestamp(),
          updated_at = clock_timestamp()

        WHERE existing.family_id = EXCLUDED.family_id
          AND existing.purchased_by_user_id =
              EXCLUDED.purchased_by_user_id

        RETURNING id, status, access_expires_at, auto_renew_enabled
      `,
      [
        intent.family_id,
        userId,
        product.rows[0].id,
        billingEnvironment,
        originalTransactionId,
        state.status,
        state.periodStart,
        state.periodEnd,
        state.accessExpiresAt,
        state.gracePeriodEndsAt,
        state.autoRenewEnabled,
        state.revokedAt,
      ],
    );

    if (subscription.rowCount === 0) {
      throw serviceError(
        "APPLE_SUBSCRIPTION_ALREADY_LINKED",
        "This Apple subscription is already linked to another account or family.",
        409,
      );
    }

    const savedSubscription = subscription.rows[0];

    // Enregistre la transaction présentée et la plus récente.
    // Les renouvellements intermédiaires seront récupérés
    // par les notifications et le rattrapage d'historique.
    const transactions = new Map();

    transactions.set(purchasedTransaction.transactionId, purchasedTransaction);

    transactions.set(current.transaction.transactionId, current.transaction);

    for (const transaction of transactions.values()) {
      await saveTransaction(client, {
        transaction,
        subscriptionId: savedSubscription.id,
        intentId: intent.id,
        environment: billingEnvironment,
      });
    }

    await client.query(
      `
        UPDATE subscription_purchase_intents
        SET status = 'completed',
            completed_at = COALESCE(completed_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [intent.id],
    );

    await client.query("COMMIT");

    return {
      verified: true,
      familyId: intent.family_id,
      subscription: {
        id: savedSubscription.id,
        status: savedSubscription.status,
        accessExpiresAt: savedSubscription.access_expires_at,
        autoRenewEnabled: savedSubscription.auto_renew_enabled,
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      console.error("Unable to rollback Apple purchase.");
    }

    throw error;
  } finally {
    client.release();
  }
}

// Point d'entrée utilisé par le contrôleur d'achat.
// Aucun paramètre externe ne peut activer le mode notification.
async function verifyAndSaveApplePurchase({
  userId,
  purchaseIntentId,
  transactionId,
}) {
  return synchronizeApplePurchase({
    userId,
    purchaseIntentId,
    transactionId,
    fromNotification: false,
  });
}

// Point d'entrée interne pour le futur traitement des notifications.
// Ne pas exposer cette fonction dans une route accessible aux utilisateurs.
async function synchronizeAppleSubscriptionFromNotification({ transactionId }) {
  if (
    typeof transactionId !== "string" ||
    !/^[0-9]{1,64}$/.test(transactionId)
  ) {
    throw serviceError(
      "INVALID_APPLE_TRANSACTION_ID",
      "A valid Apple transaction ID is required.",
      400,
    );
  }

  const { billingEnvironment, bundleId } = getAppleBillingConnection();

  // Récupère et vérifie la transaction auprès d'Apple.
  // Le rattachement ne repose pas sur des identifiants fournis par l'app.
  const transaction = await verifyAppleCall(() =>
    getVerifiedAppleTransaction({ transactionId }),
  );

  const accountToken = transaction.appAccountToken;

  if (typeof accountToken !== "string" || !UUID_PATTERN.test(accountToken)) {
    throw serviceError(
      "APPLE_PURCHASE_INTENT_UNRESOLVED",
      "The Apple transaction cannot be linked to a prepared purchase.",
      409,
    );
  }

  const purchaseIntentId = accountToken.toLowerCase();

  const result = await pool.query(
    `
      SELECT *
      FROM subscription_purchase_intents
      WHERE id = $1
        AND purchase_kind = 'subscription'
        AND payment_provider = 'app_store'
        AND environment = $2
    `,
    [purchaseIntentId, billingEnvironment],
  );

  if (result.rowCount === 0) {
    throw serviceError(
      "APPLE_PURCHASE_INTENT_UNRESOLVED",
      "The prepared purchase for this Apple transaction was not found.",
      409,
    );
  }

  const intent = result.rows[0];

  checkTransaction(transaction, intent, bundleId);

  return synchronizeApplePurchase({
    userId: intent.purchased_by_user_id,
    purchaseIntentId: intent.id,
    transactionId,
    fromNotification: true,
  });
}

module.exports = {
  verifyAndSaveApplePurchase,
  synchronizeAppleSubscriptionFromNotification,
};
