const pool = require("../../db/pool");

const {
  getFamilyEntitlements,
} = require("../billing/familyEntitlementsService");

const { validateUuid } = require("../tracking/trackingAccess");

const LANGUAGES = new Set(["en", "fr", "de", "es", "it", "nl", "pt"]);

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (!["sandbox", "production"].includes(environment)) {
    throw serviceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  return environment;
}

async function transaction(callback, readOnly = false) {
  const database = await pool.connect();

  try {
    await database.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
    );

    const result = await callback(database);

    await database.query("COMMIT");
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database.release();
  }
}

function mapSettings(row) {
  return row
    ? {
        enabled: row.enabled,
        languageCode: row.language_code,
        timeZone: row.time_zone,
        deliveryHour: row.delivery_hour,
        updatedAt: row.updated_at,
      }
    : {
        enabled: false,
        languageCode: null,
        timeZone: null,
        deliveryHour: 7,
        updatedAt: null,
      };
}

function requirePremium(entitlements) {
  if (!entitlements.isPremium) {
    throw serviceError(
      "PREMIUM_REQUIRED",
      "Daily reports are available with Nelo Premium.",
      403,
    );
  }
}

async function getDailyReportSettings({ familyId, userId }) {
  return transaction(async (database) => {
    const entitlements = await getFamilyEntitlements({
      familyId,
      userId,
      database,
    });

    const result = await database.query(
      `
        SELECT *
        FROM family_daily_report_settings
        WHERE family_id = $1::uuid
      `,
      [familyId],
    );

    return {
      settings: mapSettings(result.rows[0]),
      canEdit: entitlements.currentUserRole === "owner",
      premiumAvailable: entitlements.isPremium,
    };
  }, true);
}

function validateSettings(data) {
  const allowed = new Set([
    "enabled",
    "languageCode",
    "timeZone",
    "deliveryHour",
  ]);

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some((key) => !allowed.has(key)) ||
    typeof data.enabled !== "boolean" ||
    !LANGUAGES.has(data.languageCode) ||
    typeof data.timeZone !== "string" ||
    data.timeZone.length > 100 ||
    !data.timeZone.trim() ||
    !Number.isInteger(data.deliveryHour) ||
    data.deliveryHour < 0 ||
    data.deliveryHour > 23
  ) {
    throw serviceError(
      "INVALID_DAILY_REPORT_SETTINGS",
      "Invalid daily report settings.",
      400,
    );
  }
}

async function saveDailyReportSettings({ familyId, userId, data }) {
  validateUuid(familyId, "family ID");
  validateUuid(userId, "user ID");
  validateSettings(data);

  return transaction(async (database) => {
    /*
     * Verrouille le rôle du demandeur pendant la modification.
     * Un contributeur ne peut pas changer les préférences
     * communes de toute la famille.
     */
    const membership = await database.query(
      `
        SELECT fm.id

        FROM family_members fm

        INNER JOIN families family
          ON family.id = fm.family_id
          AND family.deleted_at IS NULL

        INNER JOIN users account
          ON account.id = fm.user_id
          AND account.deleted_at IS NULL
          AND account.status = 'active'

        WHERE fm.family_id = $1::uuid
          AND fm.user_id = $2::uuid
          AND fm.family_role = 'owner'
          AND fm.removed_at IS NULL

        FOR UPDATE OF fm
      `,
      [familyId, userId],
    );

    if (membership.rowCount === 0) {
      throw serviceError(
        "FAMILY_OWNER_REQUIRED",
        "Only a family owner can change daily report settings.",
        403,
      );
    }

    const entitlements = await getFamilyEntitlements({
      familyId,
      userId,
      database,
    });

    // Désactiver reste possible après expiration du Premium.
    if (data.enabled) {
      requirePremium(entitlements);
    }

    const timeZone = data.timeZone.trim();

    const zoneResult = await database.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_timezone_names
          WHERE name = $1::text
        ) AS valid
      `,
      [timeZone],
    );

    if (!zoneResult.rows[0]?.valid) {
      throw serviceError("INVALID_TIME_ZONE", "Select a valid time zone.", 400);
    }

    const result = await database.query(
      `
        INSERT INTO family_daily_report_settings (
          family_id,
          enabled,
          language_code,
          time_zone,
          delivery_hour,
          updated_by_user_id
        )
        VALUES (
          $1::uuid,
          $2::boolean,
          $3::text,
          $4::text,
          $5::smallint,
          $6::uuid
        )

        ON CONFLICT (family_id)
        DO UPDATE SET
          enabled = excluded.enabled,
          language_code = excluded.language_code,
          time_zone = excluded.time_zone,
          delivery_hour = excluded.delivery_hour,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = clock_timestamp()

        RETURNING *
      `,
      [
        familyId,
        data.enabled,
        data.languageCode,
        timeZone,
        data.deliveryHour,
        userId,
      ],
    );

    return {
      settings: mapSettings(result.rows[0]),
      canEdit: true,
      premiumAvailable: entitlements.isPremium,
    };
  });
}

function validateReportDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw serviceError(
      "INVALID_REPORT_DATE",
      "A valid report date is required.",
      400,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw serviceError(
      "INVALID_REPORT_DATE",
      "A valid report date is required.",
      400,
    );
  }
}

async function getDailyReport({ familyId, childId, userId, reportDate }) {
  validateUuid(familyId, "family ID");
  validateUuid(childId, "child ID");
  validateUuid(userId, "user ID");
  validateReportDate(reportDate);

  const environment = getEnvironment();

  return transaction(async (database) => {
    const entitlements = await getFamilyEntitlements({
      familyId,
      userId,
      database,
    });

    requirePremium(entitlements);

    /*
     * Être membre Premium de la famille ne suffit pas :
     * le demandeur doit aussi avoir accès à cet enfant.
     *
     * Le rattachement familial est vérifié explicitement,
     * notamment si l'enfant a changé de famille.
     */
    const access = await database.query(
      `
        SELECT child.id

        FROM children child

        INNER JOIN children_members cm
          ON cm.child_id = child.id
          AND cm.revoked_at IS NULL

        INNER JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = child.family_id
          AND fm.user_id = $3::uuid
          AND fm.removed_at IS NULL

        WHERE child.id = $1::uuid
          AND child.family_id = $2::uuid
          AND child.deleted_at IS NULL

        LIMIT 1
      `,
      [childId, familyId, userId],
    );

    if (access.rowCount === 0) {
      throw serviceError("CHILD_NOT_FOUND", "Child not found.", 404);
    }

    const result = await database.query(
      `
        SELECT
          id,
          to_char(report_date, 'YYYY-MM-DD') AS report_date,
          status,
          language_code,
          time_zone,
          period_started_at,
          period_ended_at,
          content_json,
          generated_at,
          data_cutoff_at

        FROM child_daily_reports

        WHERE family_id = $1::uuid
          AND child_id = $2::uuid
          AND environment = $3::text
          AND report_date = $4::date

        LIMIT 1
      `,
      [familyId, childId, environment, reportDate],
    );

    const row = result.rows[0];

    if (!row) {
      return {
        status: "not_available",
        report: null,
      };
    }

    return {
      status: row.status,
      report: {
        id: row.id,
        date: row.report_date,
        languageCode: row.language_code,
        timeZone: row.time_zone,
        startsAt: row.period_started_at,
        endsAt: row.period_ended_at,
        generatedAt: row.generated_at,
        dataCutoffAt: row.data_cutoff_at,

        // Aucun texte intermédiaire ou résultat échoué
        // n'est exposé.
        content: row.status === "ready" ? row.content_json : null,
      },
    };
  }, true);
}

module.exports = {
  getDailyReportSettings,
  saveDailyReportSettings,
  getDailyReport,
};
