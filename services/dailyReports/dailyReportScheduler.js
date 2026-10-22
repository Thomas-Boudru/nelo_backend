const pool = require("../../db/pool");

const {
  getFamilyEntitlements,
} = require("../billing/familyEntitlementsService");

const PAGE_SIZE = 50;
const MAX_PAGES_PER_CYCLE = 10;

// Permet de poursuivre les grandes listes au cycle suivant.
// Après un redémarrage, repartir du début reste sans danger :
// la contrainte UNIQUE empêche de recréer les mêmes rapports.
let cursor = null;
let running = false;

function schedulerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (!["sandbox", "production"].includes(environment)) {
    throw schedulerError("INVALID_BILLING_ENVIRONMENT");
  }

  return environment;
}

function safeCode(error) {
  return typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : "DAILY_REPORT_SCHEDULER_FAILED";
}

async function getSettingsPage(afterFamilyId) {
  const result = await pool.query(
    `
      SELECT
        settings.family_id

      FROM family_daily_report_settings settings

      INNER JOIN families family
        ON family.id = settings.family_id
        AND family.deleted_at IS NULL

      WHERE settings.enabled = TRUE
        AND (
          $1::uuid IS NULL
          OR settings.family_id > $1::uuid
        )

      ORDER BY settings.family_id ASC

      LIMIT $2::integer
    `,
    [afterFamilyId, PAGE_SIZE],
  );

  return result.rows;
}

async function scheduleFamily({ familyId, environment }) {
  const database = await pool.connect();

  try {
    await database.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

    await database.query("SET LOCAL statement_timeout = '15s'");
    await database.query("SET LOCAL lock_timeout = '3s'");

    /*
     * Verrou léger sur les réglages de cette famille.
     * Deux processus peuvent parcourir la même liste :
     * un seul prépare cette famille à la fois.
     */
    const settingsResult = await database.query(
      `
        SELECT
          settings.family_id,
          settings.language_code,
          settings.time_zone,
          settings.delivery_hour

        FROM family_daily_report_settings settings

        INNER JOIN families family
          ON family.id = settings.family_id
          AND family.deleted_at IS NULL

        WHERE settings.family_id = $1::uuid
          AND settings.enabled = TRUE

        FOR UPDATE OF settings SKIP LOCKED
      `,
      [familyId],
    );

    const settings = settingsResult.rows[0];

    if (!settings) {
      await database.query("COMMIT");
      return 0;
    }

    /*
     * Le service existant de droits exige un membre actif.
     * On utilise un propriétaire actif uniquement pour lire
     * les droits familiaux : il ne devient pas l'auteur du rapport.
     */
    const ownerResult = await database.query(
      `
        SELECT fm.user_id

        FROM family_members fm

        INNER JOIN users account
          ON account.id = fm.user_id
          AND account.deleted_at IS NULL
          AND account.status = 'active'

        WHERE fm.family_id = $1::uuid
          AND fm.family_role = 'owner'
          AND fm.removed_at IS NULL

        ORDER BY fm.id ASC
        LIMIT 1
      `,
      [familyId],
    );

    const owner = ownerResult.rows[0];

    if (!owner) {
      await database.query("COMMIT");
      return 0;
    }

    const entitlements = await getFamilyEntitlements({
      familyId,
      userId: owner.user_id,
      database,
    });

    // Réutilise les règles existantes :
    // abonnements directs, RevenueCat et cadeaux.
    if (!entitlements.isPremium) {
      await database.query("COMMIT");
      return 0;
    }

    /*
     * Vérifie que PostgreSQL connaît ce fuseau.
     * Aucune déduction depuis la langue ou le pays.
     */
    const zoneResult = await database.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_timezone_names
          WHERE name = $1::text
        ) AS valid
      `,
      [settings.time_zone],
    );

    if (!zoneResult.rows[0]?.valid) {
      throw schedulerError("DAILY_REPORT_INVALID_TIME_ZONE");
    }

    /*
     * On travaille avec le calendrier de la famille :
     *
     * - rapport de la veille ;
     * - disponible après delivery_hour aujourd'hui ;
     * - bornes calculées séparément pour respecter
     *   les changements d'heure.
     *
     * Pas de soustraction fixe de 24 heures.
     */
    const windowResult = await database.query(
      `
        WITH local_calendar AS (
          SELECT
            (
              transaction_timestamp()
              AT TIME ZONE $1::text
            )::date AS local_today
        ),

        report_window AS (
          SELECT
            local_today - 1 AS report_date,

            (
              (local_today - 1)::timestamp
              AT TIME ZONE $1::text
            ) AS starts_at,

            (
              local_today::timestamp
              AT TIME ZONE $1::text
            ) AS ends_at,

            (
              (
                local_today::timestamp
                + make_interval(hours => $2::integer)
              )
              AT TIME ZONE $1::text
            ) AS scheduled_at

          FROM local_calendar
        )

        SELECT
          to_char(report_date, 'YYYY-MM-DD') AS report_date,
          starts_at,
          ends_at,
          scheduled_at,

          scheduled_at <= transaction_timestamp()
            AND ends_at <= transaction_timestamp()
            AS is_due

        FROM report_window
      `,
      [settings.time_zone, settings.delivery_hour],
    );

    const window = windowResult.rows[0];

    if (!window?.is_due) {
      await database.query("COMMIT");
      return 0;
    }

    /*
     * Chaque rapport conserve sa langue et son fuseau.
     * Une modification future des préférences ne réécrit pas
     * un rapport déjà créé.
     *
     * Aucun rapport antérieur à la naissance.
     */
    const insertResult = await database.query(
      `
        INSERT INTO child_daily_reports (
          family_id,
          child_id,
          environment,
          report_date,
          language_code,
          time_zone,
          period_started_at,
          period_ended_at,
          status,
          scheduled_at,
          next_attempt_at
        )

        SELECT
          child.family_id,
          child.id,
          $2::text,
          $3::date,
          $4::text,
          $5::text,
          $6::timestamptz,
          $7::timestamptz,
          'pending',
          $8::timestamptz,
          transaction_timestamp()

        FROM children child

        WHERE child.family_id = $1::uuid
          AND child.deleted_at IS NULL
          AND child.birth_status = 'born'
          AND child.birth_date IS NOT NULL
          AND child.birth_date <= $3::date

        ON CONFLICT (
          environment,
          family_id,
          child_id,
          report_date
        )
        DO NOTHING

        RETURNING id
      `,
      [
        familyId,
        environment,
        window.report_date,
        settings.language_code,
        settings.time_zone,
        window.starts_at,
        window.ends_at,
        window.scheduled_at,
      ],
    );

    await database.query("COMMIT");

    return insertResult.rowCount;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database.release();
  }
}

async function runDailyReportSchedulerCycle() {
  if (running) return;

  running = true;

  let createdCount = 0;
  let failedFamilyCount = 0;

  try {
    const environment = getEnvironment();

    for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_CYCLE; pageIndex += 1) {
      const settings = await getSettingsPage(cursor);

      if (settings.length === 0) {
        cursor = null;
        break;
      }

      for (const row of settings) {
        try {
          createdCount += await scheduleFamily({
            familyId: row.family_id,
            environment,
          });
        } catch (error) {
          failedFamilyCount += 1;

          // Une famille en erreur ne bloque pas les suivantes.
          // Aucun suivi, nom, identifiant familial ou texte
          // du rapport n'est journalisé.
          console.error("[Daily report scheduler]", {
            code: safeCode(error),
          });
        }

        cursor = row.family_id;
      }

      if (settings.length < PAGE_SIZE) {
        cursor = null;
        break;
      }
    }

    if (createdCount > 0 || failedFamilyCount > 0) {
      console.info("[Daily report scheduler] cycle completed", {
        createdCount,
        failedFamilyCount,
      });
    }

    return {
      createdCount,
      failedFamilyCount,
    };
  } finally {
    running = false;
  }
}

module.exports = {
  runDailyReportSchedulerCycle,
};
