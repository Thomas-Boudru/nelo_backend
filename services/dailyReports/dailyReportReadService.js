const pool = require("../../db/pool");

const { readTrackingPage } = require("../tracking/trackingReadService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite technique : en cas de dépassement, ne jamais produire
// silencieusement un rapport fondé sur une lecture tronquée.
const MAX_ENTRIES = 5000;
const READ_BATCH_SIZE = 200;

function reportError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw reportError("DAILY_REPORT_INVALID_ID");
  }
}

function toIso(value) {
  return new Date(value).toISOString();
}

/*
 * Données internes destinées au calcul des agrégats.
 *
 * Ne pas transmettre directement cet objet à OpenAI :
 * le contexte IA sera construit à partir des agrégats utiles.
 *
 * Les photos, notes libres et identités des contributeurs
 * ne sont pas nécessaires à cette première version du rapport.
 */
function removeUnusedData(entry) {
  const {
    photoRows,
    photos,
    note,
    createdByUserId,
    updatedByUserId,
    deletedByUserId,
    endedByUserId,
    ...tracking
  } = entry;

  return tracking;
}

/*
 * Fonction interne au worker, jamais exposée directement en HTTP.
 *
 * Le worker doit :
 * - avoir réservé le rapport avec un execution_token ;
 * - contrôler les droits Premium avant la génération ;
 * - contrôler à nouveau sa réservation avant de sauvegarder.
 *
 * Cette fonction vérifie la réservation, le rattachement familial
 * et l'activation des rapports dans une lecture cohérente.
 */
async function readDailyReportData({ reportId, executionToken }) {
  requireUuid(reportId);
  requireUuid(executionToken);

  const database = await pool.connect();

  try {
    await database.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    await database.query("SET LOCAL statement_timeout = '15s'");

    const reportResult = await database.query(
      `
        SELECT
          r.id,
          r.family_id,
          r.child_id,
          r.environment,
          r.language_code,
          r.time_zone,

          to_char(r.report_date, 'YYYY-MM-DD') AS report_date,

          r.period_started_at,
          r.period_ended_at,

          to_char(child.birth_date, 'YYYY-MM-DD') AS birth_date,
          child.birth_status,
          child.sex_at_birth,
          child.gestational_age_weeks,
          child.gestational_age_days,

          transaction_timestamp() AS data_cutoff_at

        FROM child_daily_reports r

        INNER JOIN children child
          ON child.id = r.child_id
          AND child.family_id = r.family_id
          AND child.deleted_at IS NULL
          AND child.birth_status = 'born'

        INNER JOIN families family
          ON family.id = r.family_id
          AND family.deleted_at IS NULL

        INNER JOIN family_daily_report_settings settings
          ON settings.family_id = r.family_id
          AND settings.enabled = TRUE

        WHERE r.id = $1::uuid
          AND r.execution_token = $2::uuid
          AND r.status = 'generating'
          AND r.lease_expires_at > clock_timestamp()
          AND r.period_ended_at <= transaction_timestamp()
      `,
      [reportId, executionToken],
    );

    const report = reportResult.rows[0];

    if (!report) {
      throw reportError("DAILY_REPORT_CONTEXT_UNAVAILABLE");
    }

    /*
     * PostgreSQL calcule les bornes dans le fuseau du rapport.
     * Chaque journée peut donc durer 23, 24 ou 25 heures.
     *
     * Sept jours de référence, puis la journée analysée.
     */
    const daysResult = await database.query(
      `
        SELECT
          to_char(
            $1::date - offsets.day_offset,
            'YYYY-MM-DD'
          ) AS date_key,

          (
            ($1::date - offsets.day_offset)::timestamp
            AT TIME ZONE $2::text
          ) AS starts_at,

          (
            ($1::date - offsets.day_offset + 1)::timestamp
            AT TIME ZONE $2::text
          ) AS ends_at

        FROM generate_series(0, 7) AS offsets(day_offset)

        ORDER BY offsets.day_offset DESC
      `,
      [report.report_date, report.time_zone],
    );

    const days = daysResult.rows.map((row) => ({
      dateKey: row.date_key,
      startsAt: toIso(row.starts_at),
      endsAt: toIso(row.ends_at),
      durationSeconds:
        (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) /
        1000,
    }));

    const reportDay = days[days.length - 1];

    // Vérifie que l'instantané du rapport correspond bien
    // à sa date et à son fuseau.
    if (
      reportDay.startsAt !== toIso(report.period_started_at) ||
      reportDay.endsAt !== toIso(report.period_ended_at)
    ) {
      throw reportError("DAILY_REPORT_PERIOD_MISMATCH");
    }

    const rowsResult = await database.query(
      `
        SELECT t.*

        FROM tracking_entries t

        LEFT JOIN growth_details growth
          ON growth.tracking_entry_id = t.id
          AND t.entry_type = 'growth'

        LEFT JOIN teething_details teething
          ON teething.tracking_entry_id = t.id
          AND t.entry_type = 'teething'

        WHERE t.child_id = $1::uuid
          AND t.deleted_at IS NULL

          AND (
            (
              t.entry_type = 'sleep'
              AND t.started_at < $3::timestamptz
              AND (
                t.ended_at IS NULL
                OR t.ended_at > $2::timestamptz
              )
            )

            OR (
              t.entry_type = 'growth'
              AND growth.measurement_date >= $4::date
              AND growth.measurement_date <= $5::date
            )

            OR (
              t.entry_type = 'teething'
              AND teething.eruption_date >= $4::date
              AND teething.eruption_date <= $5::date
            )

            OR (
              t.entry_type NOT IN ('sleep', 'growth', 'teething')
              AND t.started_at >= $2::timestamptz
              AND t.started_at < $3::timestamptz
            )

            -- Ne pas masquer une entrée dont les détails
            -- obligatoires ont disparu : le sérialiseur
            -- signalera explicitement cette incohérence.
            OR (
              (
                (
                  t.entry_type = 'growth'
                  AND growth.tracking_entry_id IS NULL
                )
                OR (
                  t.entry_type = 'teething'
                  AND teething.tracking_entry_id IS NULL
                )
              )
              AND t.started_at >= $2::timestamptz
              AND t.started_at < $3::timestamptz
            )
          )

        ORDER BY t.started_at ASC, t.id ASC

        LIMIT $6::integer
      `,
      [
        report.child_id,
        days[0].startsAt,
        reportDay.endsAt,
        days[0].dateKey,
        reportDay.dateKey,
        MAX_ENTRIES + 1,
      ],
    );

    if (rowsResult.rows.length > MAX_ENTRIES) {
      throw reportError("DAILY_REPORT_TOO_MANY_ENTRIES");
    }

    const entries = [];

    for (
      let offset = 0;
      offset < rowsResult.rows.length;
      offset += READ_BATCH_SIZE
    ) {
      const batch = await readTrackingPage({
        database,
        childId: report.child_id,
        rows: rowsResult.rows.slice(offset, offset + READ_BATCH_SIZE),
      });

      entries.push(...batch.map(removeUnusedData));
    }

    // La lecture peut avoir pris du temps : vérifier que le délai
    // de réservation n'est pas déjà dépassé avant de continuer.
    const leaseResult = await database.query(
      `
        SELECT lease_expires_at > clock_timestamp() AS valid
        FROM child_daily_reports
        WHERE id = $1::uuid
          AND execution_token = $2::uuid
          AND status = 'generating'
      `,
      [reportId, executionToken],
    );

    if (leaseResult.rows[0]?.valid !== true) {
      throw reportError("DAILY_REPORT_EXECUTION_EXPIRED");
    }

    await database.query("COMMIT");

    return {
      report: {
        id: report.id,
        familyId: report.family_id,
        childId: report.child_id,
        environment: report.environment,
        dateKey: report.report_date,
        languageCode: report.language_code,
        timeZone: report.time_zone,
        startsAt: reportDay.startsAt,
        endsAt: reportDay.endsAt,
      },

      // Instant de la lecture cohérente, pas une garantie que
      // tous les appareils ont déjà synchronisé leurs saisies.
      dataCutoffAt: toIso(report.data_cutoff_at),

      child: {
        birthStatus: report.birth_status,
        birthDate: report.birth_date,
        sexAtBirth: report.sex_at_birth,
        gestationalAgeWeeks: report.gestational_age_weeks,
        gestationalAgeDays: report.gestational_age_days,
      },

      days,
      entries,
    };
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database.release();
  }
}

module.exports = {
  readDailyReportData,
};
