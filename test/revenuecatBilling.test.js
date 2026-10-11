const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.BILLING_ENVIRONMENT = "sandbox";

const pool = require("../db/pool");

const {
  mapRevenueCatSubscription,
} = require("../services/billing/revenuecat/revenuecatSubscriptionMapper");

const {
  decideRevenueCatAccess,
  revenueCatDiagnosticsEnabled,
} = require("../services/billing/revenuecat/revenuecatSyncService");

const {
  ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES,
  EXPIRED_RECONCILIATION_HOURS,
  runRevenueCatWorkerCycle,
} = require("../services/billing/revenuecat/revenuecatWorker");

function subscription(overrides = {}) {
  return {
    object: "subscription",
    id: "subscription-id",
    customer_id: "11111111-1111-4111-8111-111111111111",
    original_customer_id: "11111111-1111-4111-8111-111111111111",
    product_id: "premium.monthly",
    environment: "sandbox",
    store: "app_store",
    ownership: "purchased",
    gives_access: true,
    status: "active",
    auto_renewal_status: "will_renew",
    current_period_starts_at: Date.UTC(2026, 9, 11, 13, 35),
    current_period_ends_at: Date.UTC(2026, 9, 11, 13, 40),
    ends_at: Date.UTC(2026, 9, 11, 13, 40),
    entitlements: {
      object: "list",
      items: [{ lookup_key: "Nelo Premium" }],
      next_page: null,
    },
    ...overrides,
  };
}

test("keeps paid access until RevenueCat says gives_access is false", () => {
  const mapped = mapRevenueCatSubscription(
    subscription({ auto_renewal_status: "will_not_renew" }),
    { environment: "sandbox" },
  );

  assert.equal(mapped.givesAccess, true);
  assert.equal(mapped.status, "cancelled");
  assert.deepEqual(mapped.entitlementKeys, ["Nelo Premium"]);
});

test("does not extend access from dates when RevenueCat denies access", () => {
  const mapped = mapRevenueCatSubscription(
    subscription({
      gives_access: false,
      status: "expired",
      current_period_ends_at: Date.UTC(2026, 9, 11, 14, 0),
      ends_at: null,
      auto_renewal_status: "will_not_renew",
    }),
    { environment: "sandbox" },
  );

  assert.equal(mapped.givesAccess, false);
  assert.equal(mapped.status, "expired");
});

test("distinguishes a RevenueCat denial from a missing Premium entitlement", () => {
  const denied = mapRevenueCatSubscription(
    subscription({ gives_access: false, status: "expired", ends_at: null }),
    { environment: "sandbox" },
  );
  const deniedDecision = decideRevenueCatAccess(denied, "Nelo Premium");

  assert.equal(deniedDecision.decision, "revenuecat_denied_access");
  assert.equal(deniedDecision.givesAccess, false);

  const missing = mapRevenueCatSubscription(
    subscription({
      entitlements: { object: "list", items: [], next_page: null },
    }),
    { environment: "sandbox" },
  );
  const missingDecision = decideRevenueCatAccess(missing, "Nelo Premium");

  assert.equal(missingDecision.decision, "premium_entitlement_missing");
  assert.equal(missingDecision.givesAccess, false);
  assert.equal(missingDecision.status, "expired");
});

test("rejects an incomplete entitlement list instead of removing access", () => {
  const partial = mapRevenueCatSubscription(
    subscription({
      entitlements: {
        object: "list",
        items: [{ lookup_key: "another-entitlement" }],
        next_page: "/next-page",
      },
    }),
    { environment: "sandbox" },
  );

  assert.throws(
    () => decideRevenueCatAccess(partial, "Nelo Premium"),
    { code: "REVENUECAT_ENTITLEMENTS_INCOMPLETE" },
  );
});

test("enables RevenueCat diagnostics only for the exact trimmed value true", () => {
  const previousValue = process.env.REVENUECAT_DIAGNOSTIC_LOGS;

  try {
    process.env.REVENUECAT_DIAGNOSTIC_LOGS = " true ";
    assert.equal(revenueCatDiagnosticsEnabled(), true);

    process.env.REVENUECAT_DIAGNOSTIC_LOGS = "TRUE";
    assert.equal(revenueCatDiagnosticsEnabled(), false);

    delete process.env.REVENUECAT_DIAGNOSTIC_LOGS;
    assert.equal(revenueCatDiagnosticsEnabled(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.REVENUECAT_DIAGNOSTIC_LOGS;
    } else {
      process.env.REVENUECAT_DIAGNOSTIC_LOGS = previousValue;
    }
  }
});

test("periodic reconciliation prioritizes active states and bounds expired checks", () => {
  assert.ok(ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES.includes("active"));
  assert.equal(ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES.includes("expired"), false);
  assert.equal(EXPIRED_RECONCILIATION_HOURS, 24);
});

test("worker query applies priority, bounded expiry and retry spacing", async () => {
  const queries = [];

  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ acquired: true }] };
      }

      if (sql.includes("pg_advisory_unlock")) {
        return { rows: [{}] };
      }

      throw new Error("Unexpected lock query.");
    },
    release() {},
  });

  pool.query = async (sql, parameters) => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim();
    queries.push({ parameters, sql: normalizedSql });

    return { rowCount: 0, rows: [] };
  };

  await runRevenueCatWorkerCycle();

  const refreshQuery = queries.find(({ sql }) =>
    sql.includes("AS active_priority"),
  );

  assert.ok(refreshQuery);
  assert.match(refreshQuery.sql, /status = 'expired'/);
  assert.match(refreshQuery.sql, /current_period_end BETWEEN/);
  assert.match(refreshQuery.sql, /INTERVAL '5 minutes'/);
  assert.match(refreshQuery.sql, /ORDER BY BOOL_OR/);
  assert.deepEqual(refreshQuery.parameters, [
    "sandbox",
    ACTIVE_REFRESHABLE_SUBSCRIPTION_STATUSES,
    24,
  ]);
});
