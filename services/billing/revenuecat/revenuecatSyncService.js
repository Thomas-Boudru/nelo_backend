const pool = require("../../../db/pool");

const { getRevenueCatSubscriptions } = require("./revenuecatClient");

const { mapRevenueCatSubscription } = require("./revenuecatSubscriptionMapper");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCESS_VALIDITY_MS = 15 * 60 * 1000;

function serviceError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function syncRevenueCatSubscriptions({
  userId,
  requireSubscription = false,
}) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    throw serviceError(
      "INVALID_REVENUECAT_USER",
      "A valid Nelo user ID is required.",
      400,
    );
  }

  userId = userId.toLowerCase();

  const environment = process.env.BILLING_ENVIRONMENT?.trim();
  const entitlementKey = process.env.REVENUECAT_ENTITLEMENT_ID?.trim();

  if (!["sandbox", "production"].includes(environment) || !entitlementKey) {
    throw serviceError(
      "REVENUECAT_CONFIGURATION_ERROR",
      "RevenueCat server configuration is incomplete.",
      500,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Même ordre que la préparation d'achat : utilisateur puis famille.
    // Le verrou est acquis AVANT la lecture RevenueCat pour empêcher
    // deux synchronisations concurrentes d'écrire dans le mauvais ordre.
    const user = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId],
    );

    if (user.rowCount !== 1) {
      throw serviceError(
        "REVENUECAT_USER_NOT_FOUND",
        "The RevenueCat user could not be found.",
        409,
      );
    }

    const binding = await client.query(
      `
        SELECT family_id
        FROM revenuecat_family_bindings
        WHERE user_id = $1
          AND environment = $2
      `,
      [userId, environment],
    );

    if (binding.rowCount !== 1) {
      throw serviceError(
        "REVENUECAT_FAMILY_BINDING_MISSING",
        "No family is linked to this billing account.",
        409,
      );
    }

    const familyId = binding.rows[0].family_id;

    const family = await client.query(
      `
        SELECT id
        FROM families
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [familyId],
    );

    if (family.rowCount !== 1) {
      throw serviceError(
        "REVENUECAT_FAMILY_NOT_FOUND",
        "The linked family could not be found.",
        409,
      );
    }

    const lockedBinding = await client.query(
      `
        SELECT family_id
        FROM revenuecat_family_bindings
        WHERE user_id = $1
          AND environment = $2
        FOR UPDATE
      `,
      [userId, environment],
    );

    if (lockedBinding.rows[0]?.family_id !== familyId) {
      throw serviceError(
        "REVENUECAT_FAMILY_BINDING_CHANGED",
        "The billing family binding has changed.",
        409,
      );
    }

    // Date prise avant l'appel externe : la durée de l'appel
    // ne doit pas prolonger artificiellement la confirmation.
    const verification = await client.query(
      "SELECT clock_timestamp() AS verified_at",
    );

    const verifiedAt = verification.rows[0].verified_at;

    const accessValidUntil = new Date(
      verifiedAt.getTime() + ACCESS_VALIDITY_MS,
    );

    const snapshot = await getRevenueCatSubscriptions({ userId });

    if (
      snapshot.environment !== environment ||
      snapshot.customerId !== userId
    ) {
      throw serviceError(
        "REVENUECAT_IDENTITY_MISMATCH",
        "RevenueCat returned an unexpected customer or environment.",
        502,
      );
    }

    if (requireSubscription && snapshot.subscriptions.length === 0) {
      // Une notification peut précéder la disponibilité dans l'API.
      throw serviceError(
        "REVENUECAT_SUBSCRIPTION_NOT_READY",
        "The subscription is not available in RevenueCat yet.",
      );
    }

    const savedSubscriptions = [];
    const seenIds = [];

    for (const rawSubscription of snapshot.subscriptions) {
      const subscription = mapRevenueCatSubscription(rawSubscription, {
        environment,
      });

      // Un transfert de compte doit être traité explicitement.
      // Ne pas réattribuer silencieusement l'achat à une autre famille.
      if (
        subscription.revenuecatCustomerId !== userId ||
        subscription.revenuecatOriginalCustomerId !== userId
      ) {
        throw serviceError(
          "REVENUECAT_TRANSFER_REQUIRES_REVIEW",
          "This subscription requires an account transfer review.",
          409,
        );
      }

      const productResult = await client.query(
        `
          SELECT id
          FROM subscription_products
          WHERE revenuecat_product_id = $1
            AND store = $2
            AND plan_code = 'premium'
          FOR SHARE
        `,
        [subscription.revenuecatProductId, subscription.store],
      );

      if (productResult.rowCount !== 1) {
        throw serviceError(
          "REVENUECAT_PRODUCT_NOT_CONFIGURED",
          "The RevenueCat subscription product is not configured.",
          409,
        );
      }

      const hasPremiumEntitlement =
        subscription.entitlementKeys.includes(entitlementKey);

      if (!hasPremiumEntitlement && !subscription.entitlementsComplete) {
        // Une liste partielle ne prouve pas l'absence du Premium.
        throw serviceError(
          "REVENUECAT_ENTITLEMENTS_INCOMPLETE",
          "The complete subscription entitlement list is required.",
          502,
        );
      }

      const givesAccess = subscription.givesAccess && hasPremiumEntitlement;

      const isGracePeriod = subscription.status === "grace_period";

      // En période de grâce, l'objet V2 ne donne pas de date
      // explicite de fin de grâce : on utilise la confirmation bornée.
      const accessExpiresAt = givesAccess
        ? isGracePeriod
          ? null
          : subscription.endsAt
        : null;

      if (
        givesAccess &&
        !isGracePeriod &&
        (!accessExpiresAt || accessExpiresAt.getTime() <= verifiedAt.getTime())
      ) {
        throw serviceError(
          "REVENUECAT_ACCESS_DATES_INCONSISTENT",
          "RevenueCat access dates require another verification.",
          502,
        );
      }

      // Évite de marquer active une ligne sans entitlement Premium.
      const status =
        subscription.givesAccess && !hasPremiumEntitlement
          ? "expired"
          : subscription.status;

      const saved = await client.query(
        `
          INSERT INTO subscriptions AS existing (
            family_id,
            purchased_by_user_id,
            product_id,
            store,
            environment,
            management_provider,
            revenuecat_app_user_id,
            revenuecat_subscription_id,
            store_subscription_id,
            status,
            current_period_start,
            current_period_end,
            access_expires_at,
            trial_ends_at,
            grace_period_ends_at,
            auto_renew_enabled,
            last_verified_at,
            revenuecat_gives_access,
            revenuecat_access_valid_until
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5,
            'revenuecat', ($2::uuid)::text, $6, NULL,
            $7, $8, $9, $10, $11, NULL,
            $12, $13, $14, $15
          )

          ON CONFLICT (
            environment,
            revenuecat_subscription_id
          )
          WHERE revenuecat_subscription_id IS NOT NULL

          DO UPDATE SET
            product_id = EXCLUDED.product_id,
            status = EXCLUDED.status,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            access_expires_at = EXCLUDED.access_expires_at,
            trial_ends_at = EXCLUDED.trial_ends_at,
            grace_period_ends_at = NULL,
            auto_renew_enabled = EXCLUDED.auto_renew_enabled,
            last_verified_at = EXCLUDED.last_verified_at,
            revenuecat_gives_access = EXCLUDED.revenuecat_gives_access,
            revenuecat_access_valid_until =
              EXCLUDED.revenuecat_access_valid_until,
            updated_at = clock_timestamp()

          WHERE existing.family_id = EXCLUDED.family_id
            AND existing.purchased_by_user_id =
              EXCLUDED.purchased_by_user_id
            AND existing.revenuecat_app_user_id =
              EXCLUDED.revenuecat_app_user_id
            AND existing.management_provider = 'revenuecat'
            AND existing.store = EXCLUDED.store

          RETURNING
            id,
            status,
            access_expires_at,
            revenuecat_gives_access
        `,
        [
          familyId,
          userId,
          productResult.rows[0].id,
          subscription.store,
          environment,
          subscription.revenuecatSubscriptionId,
          status,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
          accessExpiresAt,
          subscription.trialEndsAt,
          subscription.autoRenewEnabled,
          verifiedAt,
          givesAccess,
          accessValidUntil,
        ],
      );

      if (saved.rowCount !== 1) {
        throw serviceError(
          "REVENUECAT_SUBSCRIPTION_ALREADY_LINKED",
          "This subscription is already linked to another account or family.",
          409,
        );
      }

      seenIds.push(subscription.revenuecatSubscriptionId);
      savedSubscriptions.push(saved.rows[0]);
    }

    // Seulement après récupération ET validation de toute la liste.
    // Une erreur réseau n'atteint jamais cette requête.
    await client.query(
      `
        UPDATE subscriptions
        SET
          revenuecat_gives_access = FALSE,
          revenuecat_access_valid_until = $4,
          access_expires_at = NULL,
          status = 'expired',
          auto_renew_enabled = FALSE,
          last_verified_at = $4,
          updated_at = clock_timestamp()
        WHERE management_provider = 'revenuecat'
          AND revenuecat_app_user_id = $1
          AND environment = $2
          AND family_id = $3
          AND NOT (
            revenuecat_subscription_id = ANY($5::text[])
          )
      `,
      [userId, environment, familyId, verifiedAt, seenIds],
    );

    await client.query("COMMIT");

    return {
      familyId,
      environment,
      subscriptions: savedSubscriptions,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  syncRevenueCatSubscriptions,
};
