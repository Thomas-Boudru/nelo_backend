const pool = require("../../db/pool");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createServiceError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function getBillingEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT;

  if (!["sandbox", "production"].includes(environment)) {
    throw createServiceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  return environment;
}

async function getFamilyEntitlements({ familyId, userId, database = pool }) {
  if (!userId || !UUID_PATTERN.test(userId)) {
    throw createServiceError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required.",
      401,
    );
  }

  if (!familyId || !UUID_PATTERN.test(familyId)) {
    throw createServiceError(
      "INVALID_FAMILY_ID",
      "A valid family ID is required.",
      400,
    );
  }

  const environment = getBillingEnvironment();

  // Une seule requête pour lire les permissions,
  // les droits actifs et les compteurs de façon cohérente.
  const result = await database.query(
    `
      WITH membership AS (
        SELECT fm.family_role

        FROM family_members fm

        INNER JOIN families f
          ON f.id = fm.family_id
          AND f.deleted_at IS NULL

        INNER JOIN users u
          ON u.id = fm.user_id
          AND u.deleted_at IS NULL
          AND u.status = 'active'

        WHERE fm.family_id = $1
          AND fm.user_id = $2
          AND fm.removed_at IS NULL

        ORDER BY
          CASE WHEN fm.family_role = 'owner' THEN 0 ELSE 1 END,
          fm.id

        LIMIT 1
      ),

      active_access AS (
        SELECT
          'subscription'::text AS source,
          s.access_expires_at AS ends_at

        FROM subscriptions s

        INNER JOIN subscription_products p
          ON p.id = s.product_id
          AND p.store = s.store

        WHERE s.family_id = $1
          AND s.environment = $3
          AND p.plan_code = 'premium'
          AND s.status IN (
            'active',
            'grace_period',
            'cancelled'
          )
          AND s.revoked_at IS NULL
          AND s.last_verified_at IS NOT NULL
          AND s.access_expires_at > NOW()
          AND EXISTS (SELECT 1 FROM membership)

        UNION ALL

        SELECT
          'gift'::text AS source,
          g.ends_at

        FROM family_access_grants g

        INNER JOIN subscription_gifts gift
          ON gift.id = g.gift_id
          AND gift.redeemed_family_id = g.family_id
          AND gift.plan_code = g.plan_code
          AND gift.environment = g.environment

        WHERE g.family_id = $1
          AND g.environment = $3
          AND g.plan_code = 'premium'
          AND g.starts_at <= NOW()
          AND g.ends_at > NOW()
          AND g.revoked_at IS NULL
          AND gift.status = 'redeemed'
          AND gift.paid_at IS NOT NULL
          AND gift.redeemed_at IS NOT NULL
          AND gift.refunded_at IS NULL
          AND gift.revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM membership)
      ),

      access_summary AS (
        SELECT
          COUNT(*) > 0 AS is_premium,
          MAX(ends_at) AS access_expires_at,

          COALESCE(
            array_agg(DISTINCT source),
            ARRAY[]::text[]
          ) AS sources

        FROM active_access
      ),

      selected_plan AS (
        SELECT
          m.family_role,
          a.is_premium,
          a.access_expires_at,
          a.sources,

          CASE
            WHEN a.is_premium THEN 'premium'
            ELSE 'free'
          END AS plan_code

        FROM membership m
        CROSS JOIN access_summary a
      ),

      feature_periods AS (
        SELECT
          pf.*,

          CASE pf.quota_period
            WHEN 'day' THEN
              date_trunc('day', NOW() AT TIME ZONE 'UTC')
                AT TIME ZONE 'UTC'

            WHEN 'month' THEN
              date_trunc('month', NOW() AT TIME ZONE 'UTC')
                AT TIME ZONE 'UTC'

            ELSE NULL
          END AS period_starts_at,

          CASE pf.quota_period
            WHEN 'day' THEN
              (
                date_trunc('day', NOW() AT TIME ZONE 'UTC')
                + INTERVAL '1 day'
              ) AT TIME ZONE 'UTC'

            WHEN 'month' THEN
              (
                date_trunc('month', NOW() AT TIME ZONE 'UTC')
                + INTERVAL '1 month'
              ) AT TIME ZONE 'UTC'

            ELSE NULL
          END AS period_ends_at

        FROM subscription_plan_features pf

        INNER JOIN selected_plan sp
          ON sp.plan_code = pf.plan_code
      ),

      feature_values AS (
        SELECT
          fp.feature_code,
          fp.access_level,
          fp.quota_limit,
          fp.quota_period,
          fp.period_starts_at,
          fp.period_ends_at,

          COALESCE(fu.used_units, 0) AS used_units,
          COALESCE(fu.reserved_units, 0) AS reserved_units

        FROM feature_periods fp

        LEFT JOIN feature_usage fu
          ON fu.family_id = $1
          AND fu.feature_code = fp.feature_code
          AND fu.environment = $3
          AND fu.quota_period = fp.quota_period
          AND fu.period_starts_at = fp.period_starts_at
      )

      SELECT
        sp.*,
        NOW() AS server_time,

        COALESCE(
          (
            SELECT jsonb_object_agg(
              fv.feature_code,

              jsonb_build_object(
                'accessLevel', fv.access_level,

                'enabled',
                  fv.access_level <> 'disabled',

                'quota',
                  CASE
                    WHEN fv.quota_limit IS NULL THEN NULL

                    ELSE jsonb_build_object(
                      'limit', fv.quota_limit,
                      'period', fv.quota_period,
                      'used', fv.used_units,
                      'reserved', fv.reserved_units,

                      'remaining',
                        CASE
                          WHEN fv.access_level = 'disabled' THEN 0
                          ELSE GREATEST(
                            0::bigint,
                            fv.quota_limit::bigint
                              - fv.used_units::bigint
                              - fv.reserved_units::bigint
                          )
                        END,

                      'startsAt', fv.period_starts_at,
                      'resetsAt', fv.period_ends_at
                    )
                  END
              )
            )

            FROM feature_values fv
          ),
          '{}'::jsonb
        ) AS features

      FROM selected_plan sp
    `,
    [familyId, userId, environment],
  );

  if (result.rowCount === 0) {
    throw createServiceError(
      "FAMILY_NOT_FOUND",
      "The family could not be found.",
      404,
    );
  }

  const row = result.rows[0];

  if (Object.keys(row.features).length === 0) {
    throw createServiceError(
      "SUBSCRIPTION_PLAN_NOT_CONFIGURED",
      "The subscription plan is not configured correctly.",
      500,
    );
  }

  return {
    familyId,
    planCode: row.plan_code,
    isPremium: row.is_premium,

    premiumAccess: row.is_premium
      ? {
          sources: row.sources,
          expiresAt: row.access_expires_at,
        }
      : null,

    currentUserRole: row.family_role,
    quotaScope: "family",
    quotaTimezone: "UTC",

    features: row.features,
    serverTime: row.server_time,
  };
}

module.exports = {
  getFamilyEntitlements,
};
