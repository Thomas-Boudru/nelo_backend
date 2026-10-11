function mappingError(message) {
  const error = new Error(message);
  error.code = "REVENUECAT_INVALID_SUBSCRIPTION";
  error.status = 502;
  return error;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw mappingError(`Missing or invalid RevenueCat field: ${field}.`);
  }

  return value;
}

function toDate(value, field, { nullable = false } = {}) {
  if (value === null && nullable) {
    return null;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) {
    throw mappingError(`Invalid RevenueCat date: ${field}.`);
  }

  return new Date(value);
}

const AUTO_RENEWAL_STATUSES = new Set([
  "will_renew",
  "will_not_renew",
  "will_change_product",
  "will_pause",
  "requires_price_increase_consent",
  "has_already_renewed",
]);

function mapStatus(subscription) {
  // Le droit d'accès est prioritaire sur le libellé du statut.
  if (subscription.gives_access) {
    if (subscription.status === "in_grace_period") {
      return "grace_period";
    }

    // Une résiliation du renouvellement ne supprime pas
    // l'accès à la période déjà payée.
    if (subscription.auto_renewal_status === "will_not_renew") {
      return "cancelled";
    }

    return "active";
  }

  switch (subscription.status) {
    case "paused":
      return "paused";

    case "in_billing_retry":
      return "on_hold";

    case "incomplete":
      return "pending";

    default:
      // Aucun droit d'accès confirmé.
      // Ne pas inventer une révocation ou un remboursement.
      return "expired";
  }
}

function mapRevenueCatSubscription(subscription, { environment }) {
  if (
    !subscription ||
    subscription.object !== "subscription" ||
    subscription.environment !== environment ||
    !["sandbox", "production"].includes(environment)
  ) {
    throw mappingError("Invalid RevenueCat subscription or environment.");
  }

  if (!["app_store", "play_store"].includes(subscription.store)) {
    throw mappingError("Unsupported RevenueCat subscription store.");
  }

  if (subscription.ownership !== "purchased") {
    // Le partage Apple et le partage de famille Nelo
    // ne sont pas le même mécanisme.
    throw mappingError(
      "This subscription ownership requires separate handling.",
    );
  }

  if (typeof subscription.gives_access !== "boolean") {
    throw mappingError("Missing RevenueCat access information.");
  }

  requiredString(subscription.status, "status");

  if (!AUTO_RENEWAL_STATUSES.has(subscription.auto_renewal_status)) {
    throw mappingError("Unsupported RevenueCat auto renewal status.");
  }

  const currentPeriodStart = toDate(
    subscription.current_period_starts_at,
    "current_period_starts_at",
  );

  const currentPeriodEnd = toDate(
    subscription.current_period_ends_at,
    "current_period_ends_at",
    { nullable: true },
  );

  const endsAt = toDate(subscription.ends_at, "ends_at", { nullable: true });

  if (
    currentPeriodEnd !== null &&
    currentPeriodEnd.getTime() < currentPeriodStart.getTime()
  ) {
    throw mappingError("Invalid RevenueCat subscription period.");
  }

  const entitlementList = subscription.entitlements;

  if (
    entitlementList?.object !== "list" ||
    !Array.isArray(entitlementList.items)
  ) {
    throw mappingError("Invalid RevenueCat entitlement list.");
  }

  const entitlementKeys = entitlementList.items.map((entitlement) =>
    requiredString(entitlement?.lookup_key, "entitlement.lookup_key"),
  );

  return {
    revenuecatSubscriptionId: requiredString(subscription.id, "id"),

    revenuecatCustomerId: requiredString(
      subscription.customer_id,
      "customer_id",
    ),

    revenuecatOriginalCustomerId: requiredString(
      subscription.original_customer_id,
      "original_customer_id",
    ),

    revenuecatProductId: requiredString(subscription.product_id, "product_id"),

    environment,
    store: subscription.store,
    managementProvider: "revenuecat",

    // Ne pas utiliser l'identifiant de la dernière transaction
    // comme originalTransactionId Apple ou purchaseToken Google.
    storeSubscriptionId: null,

    status: mapStatus(subscription),

    currentPeriodStart,
    currentPeriodEnd,

    // Conserver séparément le droit d'accès et la fin de période.
    givesAccess: subscription.gives_access,
    endsAt,

    trialEndsAt: subscription.status === "trialing" ? currentPeriodEnd : null,

    autoRenewEnabled: [
      "will_renew",
      "will_change_product",
      "has_already_renewed",
    ].includes(subscription.auto_renewal_status),

    entitlementKeys,

    // Le service devra compléter la liste si elle est paginée
    // avant de conclure qu'un entitlement est absent.
    entitlementsComplete: entitlementList.next_page == null,
  };
}

module.exports = {
  mapRevenueCatSubscription,
};
