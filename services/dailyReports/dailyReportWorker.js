const { randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const {
  getFamilyEntitlements,
} = require("../billing/familyEntitlementsService");

const { readDailyReportData } = require("./dailyReportReadService");

const {
  PROMPT_VERSION,
  buildDailyReportContext,
} = require("./dailyReportContextService");

const {
  generateDailyReport,
  getDailyReportConfiguration,
} = require("./dailyReportOpenAIClient");

let running = false;

function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeCode(error) {
  return typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : "DAILY_REPORT_PROCESSING_FAILED";
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (!["sandbox", "production"].includes(environment)) {
    throw workerError("INVALID_BILLING_ENVIRONMENT");
  }

  return environment;
}

async function transaction(callback) {
  const database = await pool.connect();

  try {
    await database.query("BEGIN");
    await database.query("SET LOCAL statement_timeout = '15s'");
    await database.query("SET LOCAL lock_timeout = '3s'");

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

async function recoverExpiredReports(environment) {
  /*
   * Une exécution interrompue n'est pas automatiquement renvoyée
   * à OpenAI : le résultat de son éventuel appel est inconnu.
   */
  await pool.query(
    `
      UPDATE child_daily_reports
      SET
        status = 'failed',
        last_error_code = 'DAILY_REPORT_EXECUTION_EXPIRED',
        execution_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()

      WHERE environment = $1::text
        AND status = 'generating'
        AND lease_expires_at <= clock_timestamp()
    `,
    [environment],
  );
}

async function claimReport(environment) {
  const result = await pool.query(
    `
      WITH candidate AS (
        SELECT id

        FROM child_daily_reports

        WHERE environment = $1::text
          AND status = 'pending'
          AND scheduled_at <= clock_timestamp()
          AND next_attempt_at <= clock_timestamp()

        ORDER BY scheduled_at ASC, id ASC

        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )

      UPDATE child_daily_reports report

      SET
        status = 'generating',
        execution_token = $2::uuid,
        lease_expires_at =
          clock_timestamp() + INTERVAL '5 minutes',
        attempt_count = attempt_count + 1,
        last_error_code = NULL,
        updated_at = clock_timestamp()

      FROM candidate
      WHERE report.id = candidate.id

      RETURNING report.*
    `,
    [environment, randomUUID()],
  );

  return result.rows[0] ?? null;
}

/*
 * Vérification dans la transaction qui prépare l'appel
 * ou qui termine le rapport.
 *
 * Le verrou sur la tâche empêche un ancien worker de remplacer
 * le résultat d'une nouvelle exécution.
 */
async function requireOwnedReport(database, report) {
  const result = await database.query(
    `
      SELECT id

      FROM child_daily_reports

      WHERE id = $1::uuid
        AND environment = $2::text
        AND execution_token = $3::uuid
        AND status = 'generating'
        AND lease_expires_at > clock_timestamp()

      FOR UPDATE
    `,
    [report.id, report.environment, report.execution_token],
  );

  if (result.rowCount !== 1) {
    throw workerError("DAILY_REPORT_EXECUTION_LOST");
  }
}

async function hasReportAccess(database, report) {
  const result = await database.query(
    `
      SELECT owner.user_id

      FROM children child

      INNER JOIN families family
        ON family.id = child.family_id
        AND family.deleted_at IS NULL

      INNER JOIN family_daily_report_settings settings
        ON settings.family_id = family.id
        AND settings.enabled = TRUE

      JOIN LATERAL (
        SELECT fm.user_id

        FROM family_members fm

        INNER JOIN users account
          ON account.id = fm.user_id
          AND account.deleted_at IS NULL
          AND account.status = 'active'

        WHERE fm.family_id = family.id
          AND fm.family_role = 'owner'
          AND fm.removed_at IS NULL

        ORDER BY fm.id ASC
        LIMIT 1
      ) owner ON TRUE

      WHERE child.id = $1::uuid
        AND child.family_id = $2::uuid
        AND child.deleted_at IS NULL
        AND child.birth_status = 'born'
    `,
    [report.child_id, report.family_id],
  );

  const owner = result.rows[0];

  if (!owner) return false;

  const entitlements = await getFamilyEntitlements({
    familyId: report.family_id,
    userId: owner.user_id,
    database,
  });

  return entitlements.isPremium === true;
}

async function cancelReport(database, report) {
  await database.query(
    `
      UPDATE child_daily_reports

      SET
        status = 'cancelled',
        last_error_code = 'DAILY_REPORT_ACCESS_UNAVAILABLE',
        execution_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()

      WHERE id = $1::uuid
        AND execution_token = $2::uuid
        AND status = 'generating'
    `,
    [report.id, report.execution_token],
  );
}

async function checkAccess(report) {
  return transaction(async (database) => {
    await requireOwnedReport(database, report);

    if (!(await hasReportAccess(database, report))) {
      await cancelReport(database, report);
      return false;
    }

    return true;
  });
}

async function prepareGeneration(report, context, model) {
  return transaction(async (database) => {
    await requireOwnedReport(database, report);

    if (!(await hasReportAccess(database, report))) {
      await cancelReport(database, report);
      return false;
    }

    await database.query(
      `
        UPDATE child_daily_reports

        SET
          input_hash = $3::text,
          data_cutoff_at = $4::timestamptz,
          prompt_version = $5::text,
          model_name = $6::text,
          lease_expires_at =
            clock_timestamp() + INTERVAL '5 minutes',
          updated_at = clock_timestamp()

        WHERE id = $1::uuid
          AND execution_token = $2::uuid
          AND status = 'generating'
      `,
      [
        report.id,
        report.execution_token,
        context.inputHash,
        context.dataCutoffAt,
        context.promptVersion,
        model,
      ],
    );

    return true;
  });
}

async function completeWithoutData(report, context) {
  await transaction(async (database) => {
    await requireOwnedReport(database, report);

    if (!(await hasReportAccess(database, report))) {
      await cancelReport(database, report);
      return;
    }

    await database.query(
      `
        UPDATE child_daily_reports

        SET
          status = 'insufficient_data',
          input_hash = $3::text,
          data_cutoff_at = $4::timestamptz,
          prompt_version = $5::text,
          content_json = NULL,
          last_error_code = NULL,
          execution_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()

        WHERE id = $1::uuid
          AND execution_token = $2::uuid
          AND status = 'generating'
      `,
      [
        report.id,
        report.execution_token,
        context.inputHash,
        context.dataCutoffAt,
        context.promptVersion,
      ],
    );
  });
}

async function recordUsage(report, outcome) {
  /*
   * Enregistre la consommation avant les derniers contrôles
   * d'accès. Un appel peut avoir été facturé même si le rapport
   * ne peut finalement pas être publié.
   *
   * attempt_count protège contre l'écrasement d'une tentative
   * plus récente, y compris après récupération d'un bail expiré.
   */
  await pool.query(
    `
      UPDATE child_daily_reports

      SET
        input_tokens = $3::bigint,
        output_tokens = $4::bigint,
        updated_at = clock_timestamp()

      WHERE id = $1::uuid
        AND attempt_count = $2::integer
    `,
    [
      report.id,
      report.attempt_count,
      outcome.call.inputTokens,
      outcome.call.outputTokens,
    ],
  );
}

async function completeReport(report, outcome) {
  await transaction(async (database) => {
    await requireOwnedReport(database, report);

    if (!(await hasReportAccess(database, report))) {
      await cancelReport(database, report);
      return;
    }

    await database.query(
      `
        UPDATE child_daily_reports

        SET
          status = 'ready',
          content_json = $3::jsonb,
          model_name = $4::text,
          generated_at = clock_timestamp(),
          last_error_code = NULL,
          execution_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()

        WHERE id = $1::uuid
          AND execution_token = $2::uuid
          AND status = 'generating'
      `,
      [
        report.id,
        report.execution_token,
        JSON.stringify(outcome.report),
        outcome.call.responseModel || outcome.call.requestedModel,
      ],
    );
  });
}

async function failReport(report, code) {
  await pool.query(
    `
      UPDATE child_daily_reports

      SET
        status = 'failed',
        last_error_code = $3::text,
        execution_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()

      WHERE id = $1::uuid
        AND execution_token = $2::uuid
        AND status = 'generating'
    `,
    [report.id, report.execution_token, code],
  );
}

async function runDailyReportWorkerCycle() {
  if (running) return;

  running = true;
  let report = null;

  try {
    const environment = getEnvironment();

    await recoverExpiredReports(environment);

    report = await claimReport(environment);

    if (!report) return;

    if (!(await checkAccess(report))) return;

    const data = await readDailyReportData({
      reportId: report.id,
      executionToken: report.execution_token,
    });

    const context = buildDailyReportContext(data);

    if (context.promptVersion !== PROMPT_VERSION) {
      throw workerError("DAILY_REPORT_UNSUPPORTED_PROMPT");
    }

    if (context.status === "insufficient_data") {
      await completeWithoutData(report, context);
      return;
    }

    const { model } = getDailyReportConfiguration();

    const canGenerate = await prepareGeneration(report, context, model);

    if (!canGenerate) return;

    const outcome = await generateDailyReport({ context });

    await recordUsage(report, outcome);

    if (outcome.status !== "completed") {
      await failReport(
        report,
        outcome.status === "unknown"
          ? "DAILY_REPORT_AI_OUTCOME_UNKNOWN"
          : outcome.errorCode,
      );

      console.error("[Daily report worker]", {
        code: outcome.errorCode,
        outcome: outcome.status,
      });

      return;
    }

    await completeReport(report, outcome);
  } catch (error) {
    const code = safeCode(error);

    console.error("[Daily report worker]", { code });

    if (report) {
      try {
        await failReport(report, code);
      } catch (cleanupError) {
        // Si la base est indisponible, le prochain cycle
        // récupérera la tâche après expiration de son bail.
        console.error("[Daily report worker cleanup]", {
          code: safeCode(cleanupError),
        });
      }
    }
  } finally {
    running = false;
  }
}

module.exports = {
  runDailyReportWorkerCycle,
};
