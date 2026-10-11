const pool = require("../../../db/pool");

const {
  getFamilyEntitlements,
} = require("../../../services/billing/familyEntitlementsService");

const {
  syncRevenueCatSubscriptions,
} = require("../../../services/billing/revenuecat/revenuecatSyncService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

async function syncRevenueCatPurchase(req, res, next) {
  try {
    // L'identité vient exclusivement du middleware d'authentification.
    const userId = req.auth?.userId;
    const requestedFamilyId = req.body?.familyId;

    if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      throw serviceError(
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
        401,
      );
    }

    if (
      typeof requestedFamilyId !== "string" ||
      !UUID_PATTERN.test(requestedFamilyId)
    ) {
      throw serviceError(
        "INVALID_FAMILY_ID",
        "A valid family ID is required.",
        400,
      );
    }

    const familyId = requestedFamilyId.toLowerCase();
    const normalizedUserId = userId.toLowerCase();

    // Vérifie que l'utilisateur a toujours accès à cette famille.
    // Vérifie également la configuration de l'environnement.
    await getFamilyEntitlements({
      familyId,
      userId: normalizedUserId,
    });

    const environment = process.env.BILLING_ENVIRONMENT.trim();

    const binding = await pool.query(
      `
        SELECT family_id
        FROM revenuecat_family_bindings
        WHERE user_id = $1
          AND environment = $2
      `,
      [normalizedUserId, environment],
    );

    if (binding.rowCount !== 1) {
      throw serviceError(
        "REVENUECAT_FAMILY_BINDING_MISSING",
        "No family is linked to this billing account.",
        409,
      );
    }

    if (binding.rows[0].family_id !== familyId) {
      throw serviceError(
        "BILLING_FAMILY_CHANGE_REQUIRES_REVIEW",
        "Your billing account is linked to another family.",
        409,
      );
    }

    // Le service retrouve lui-même la famille liée.
    // Aucun statut Premium ni identifiant RevenueCat envoyé
    // par le téléphone n'est utilisé comme preuve d'achat.
    const result = await syncRevenueCatSubscriptions({
      userId: normalizedUserId,
    });

    if (result.familyId !== familyId) {
      throw serviceError(
        "REVENUECAT_FAMILY_BINDING_CHANGED",
        "The billing family binding has changed.",
        409,
      );
    }

    // Relit aussi les permissions après la synchronisation.
    const entitlements = await getFamilyEntitlements({
      familyId,
      userId: normalizedUserId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      synchronized: true,
      familyId,
      entitlements,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  syncRevenueCatPurchase,
};
