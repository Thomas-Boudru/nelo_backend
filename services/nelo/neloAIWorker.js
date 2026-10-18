const { randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const { prepareNeloContext } = require("./neloContextService");
const { generateNeloAnswer } = require("./neloOpenAIClient");

const {
  completeFeatureUsage,
  releaseFeatureUsage,
} = require("../billing/featureUsageService");

function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeCode(error) {
  return typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : "NELO_AI_PROCESSING_FAILED";
}

function getEnvironment() {
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (!["sandbox", "production"].includes(environment)) {
    throw workerError("INVALID_BILLING_ENVIRONMENT");
  }

  return environment;
}

async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/*
 * Ordre de verrouillage commun aux opérations du worker :
 * famille, conversation, exécution.
 *
 * Aucun verrou SQL n'est conservé pendant l'appel OpenAI.
 */
async function lockRun(client, run) {
  await client.query("SELECT id FROM families WHERE id = $1::uuid FOR UPDATE", [
    run.family_id,
  ]);

  await client.query(
    `
      SELECT id
      FROM nelo_conversations
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [run.conversation_id],
  );

  const result = await client.query(
    `
      SELECT *,
        lease_expires_at > clock_timestamp() AS lease_valid,
        created_at < clock_timestamp() - INTERVAL '15 minutes'
          AS queue_expired
      FROM nelo_ai_runs
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [run.id],
  );

  return result.rows[0] ?? null;
}

function ownsRun(current, run) {
  return (
    current?.status === "running" &&
    current.execution_token === run.execution_token &&
    current.lease_valid
  );
}

async function hasChildAccess(client, run) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM nelo_conversations c

        INNER JOIN children child
          ON child.id = c.child_id
          AND child.family_id = c.family_id

        INNER JOIN families family
          ON family.id = c.family_id

        INNER JOIN users account
          ON account.id = c.user_id

        WHERE c.id = $1::uuid
          AND c.user_id = $2::uuid
          AND c.family_id = $3::uuid
          AND c.child_id = $4::uuid
          AND c.deleted_at IS NULL
          AND c.status = 'active'
          AND child.deleted_at IS NULL
          AND family.deleted_at IS NULL
          AND account.deleted_at IS NULL
          AND account.status = 'active'

          AND EXISTS (
            SELECT 1
            FROM children_members cm
            INNER JOIN family_members fm
              ON fm.id = cm.family_member_id
            WHERE cm.child_id = child.id
              AND cm.revoked_at IS NULL
              AND fm.family_id = family.id
              AND fm.user_id = account.id
              AND fm.removed_at IS NULL
          )
      ) AS allowed
    `,
    [run.conversation_id, run.user_id, run.family_id, run.child_id],
  );

  return result.rows[0].allowed;
}

/*
 * Une exécution dispose de trois minutes.
 * L'appel OpenAI est lui-même limité à une minute dans le client.
 *
 * Si le processus disparaît, le nettoyage récupérera l'exécution
 * expirée. Une ancienne réponse ne pourra plus être sauvegardée.
 */
async function claimRun(environment) {
  const executionToken = randomUUID();

  const result = await pool.query(
    `
      WITH candidate AS (
        SELECT id
        FROM nelo_ai_runs
        WHERE environment = $1
          AND status = 'queued'
          AND created_at >=
            clock_timestamp() - INTERVAL '15 minutes'
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE nelo_ai_runs r
      SET
        status = 'running',
        current_step = 'preparing_context',
        execution_token = $2::uuid,
        started_at = clock_timestamp(),
        heartbeat_at = clock_timestamp(),
        lease_expires_at =
          clock_timestamp() + INTERVAL '3 minutes',
        updated_at = clock_timestamp()
      FROM candidate
      WHERE r.id = candidate.id
      RETURNING r.*
    `,
    [environment, executionToken],
  );

  return result.rows[0] ?? null;
}

async function setStep(run, stepCode) {
  await transaction(async (client) => {
    const current = await lockRun(client, run);

    if (!ownsRun(current, run)) {
      throw workerError("NELO_AI_EXECUTION_LOST");
    }

    await client.query(
      `
        UPDATE nelo_ai_run_steps
        SET
          status = 'completed',
          finished_at = clock_timestamp()
        WHERE run_id = $1::uuid
          AND execution_token = $2::uuid
          AND status = 'running'
      `,
      [run.id, run.execution_token],
    );

    await client.query(
      `
        INSERT INTO nelo_ai_run_steps (
          run_id,
          sequence_number,
          execution_token,
          step_code
        )
        SELECT
          $1::uuid,
          COALESCE(MAX(sequence_number), 0) + 1,
          $2::uuid,
          $3
        FROM nelo_ai_run_steps
        WHERE run_id = $1::uuid
      `,
      [run.id, run.execution_token, stepCode],
    );

    await client.query(
      `
        UPDATE nelo_ai_runs
        SET current_step = $2, updated_at = clock_timestamp()
        WHERE id = $1::uuid
      `,
      [run.id, stepCode],
    );
  });
}

async function startCall(run) {
  const model = process.env.OPENAI_CHAT_MODEL?.trim();

  if (!model || !process.env.OPENAI_API_KEY?.trim()) {
    throw workerError("NELO_AI_CONFIGURATION_ERROR");
  }

  return transaction(async (client) => {
    const current = await lockRun(client, run);

    if (!ownsRun(current, run)) {
      throw workerError("NELO_AI_EXECUTION_LOST");
    }

    if (!(await hasChildAccess(client, run))) {
      throw workerError("NELO_AI_ACCESS_REVOKED");
    }

    const result = await client.query(
      `
        INSERT INTO nelo_ai_calls (
          run_id,
          sequence_number,
          execution_token,
          purpose,
          requested_model,
          prompt_version
        )
        SELECT
          $1::uuid,
          COALESCE(MAX(sequence_number), 0) + 1,
          $2::uuid,
          'answer',
          $3,
          $4
        FROM nelo_ai_calls
        WHERE run_id = $1::uuid
        RETURNING id
      `,
      [run.id, run.execution_token, model, run.prompt_version],
    );

    return result.rows[0].id;
  });
}

async function finishCall(callId, run, outcome) {
  const call = outcome.call;

  await pool.query(
    `
      UPDATE nelo_ai_calls
      SET
        status = $3,
        response_model = $4,
        provider_request_id = $5,
        provider_response_id = $6,
        input_tokens = $7,
        cached_input_tokens = $8,
        output_tokens = $9,
        reasoning_tokens = $10,
        latency_ms = $11,
        error_code = $12,
        finished_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE id = $1::uuid
        AND execution_token = $2::uuid
        AND status IN ('running', 'unknown')
    `,
    [
      callId,
      run.execution_token,
      outcome.status,
      call.responseModel,
      call.providerRequestId,
      call.providerResponseId,
      call.inputTokens,
      call.cachedInputTokens,
      call.outputTokens,
      call.reasoningTokens,
      call.latencyMs,
      outcome.errorCode,
    ],
  );
}

/*
 * Utilisé après une erreur ou pour récupérer une tâche abandonnée.
 * Le quota est libéré, mais la consommation fournisseur éventuelle
 * reste enregistrée séparément dans nelo_ai_calls.
 */
async function failRun(run, code, { recovery = false } = {}) {
  return transaction(async (client) => {
    const current = await lockRun(client, run);

    if (!current || !["queued", "running"].includes(current.status)) {
      return;
    }

    if (recovery) {
      const abandoned =
        (current.status === "running" && !current.lease_valid) ||
        (current.status === "queued" && current.queue_expired);

      if (!abandoned) return;
    } else if (!ownsRun(current, run)) {
      return;
    }

    await releaseFeatureUsage({
      operationId: current.usage_operation_id,
      reason: code,
      transactionClient: client,
    });

    await client.query(
      `
        UPDATE nelo_ai_run_steps
        SET
          status = 'failed',
          finished_at = clock_timestamp(),
          error_code = $2
        WHERE run_id = $1::uuid
          AND status = 'running'
      `,
      [run.id, code],
    );

    await client.query(
      `
        UPDATE nelo_ai_calls
        SET
          status = 'unknown',
          finished_at = clock_timestamp(),
          error_code = 'NELO_AI_CALL_OUTCOME_UNKNOWN',
          updated_at = clock_timestamp()
        WHERE run_id = $1::uuid
          AND status = 'running'
      `,
      [run.id],
    );

    await client.query(
      `
        UPDATE nelo_ai_runs
        SET
          status = 'failed',
          current_step = 'failed',
          error_code = $2,
          finished_at = clock_timestamp(),
          execution_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
        WHERE id = $1::uuid
      `,
      [run.id, code],
    );
  });
}

async function completeRun(run, answer) {
  await transaction(async (client) => {
    const current = await lockRun(client, run);

    if (!ownsRun(current, run)) {
      throw workerError("NELO_AI_EXECUTION_LOST");
    }

    if (!(await hasChildAccess(client, run))) {
      throw workerError("NELO_AI_ACCESS_REVOKED");
    }

    const operation = await client.query(
      `
        SELECT status
        FROM feature_usage_operations
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [current.usage_operation_id],
    );

    if (operation.rows[0]?.status !== "reserved") {
      throw workerError("NELO_AI_RESERVATION_UNAVAILABLE");
    }

    const conversation = await client.query(
      `
        SELECT next_message_sequence::text AS sequence
        FROM nelo_conversations
        WHERE id = $1::uuid
      `,
      [run.conversation_id],
    );

    const message = await client.query(
      `
        INSERT INTO nelo_messages (
          conversation_id,
          sequence_number,
          role,
          content,
          suggestions,
          sources
        )
        VALUES (
          $1::uuid,
          $2::bigint,
          'assistant',
          $3,
          $4::jsonb,
          '[]'::jsonb
        )
        RETURNING id
      `,
      [
        run.conversation_id,
        conversation.rows[0].sequence,
        answer.content,
        JSON.stringify(answer.suggestions),
      ],
    );

    const messageId = message.rows[0].id;

    await completeFeatureUsage({
      operationId: current.usage_operation_id,
      resultReference: messageId,
      transactionClient: client,
    });

    await client.query(
      `
        UPDATE nelo_conversations
        SET
          next_message_sequence = next_message_sequence + 1,
          last_message_at = clock_timestamp(),
          updated_at = clock_timestamp()
        WHERE id = $1::uuid
      `,
      [run.conversation_id],
    );

    await client.query(
      `
        UPDATE nelo_ai_run_steps
        SET
          status = 'completed',
          finished_at = clock_timestamp()
        WHERE run_id = $1::uuid
          AND status = 'running'
      `,
      [run.id],
    );

    await client.query(
      `
        UPDATE nelo_ai_runs
        SET
          status = 'completed',
          current_step = 'completed',
          assistant_message_id = $2::uuid,
          finished_at = clock_timestamp(),
          execution_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
        WHERE id = $1::uuid
      `,
      [run.id, messageId],
    );
  });
}

async function recoverAbandonedRuns(environment) {
  const result = await pool.query(
    `
      SELECT id, family_id, conversation_id
      FROM nelo_ai_runs
      WHERE environment = $1
        AND (
          (
            status = 'running'
            AND lease_expires_at <= clock_timestamp()
          )
          OR (
            status = 'queued'
            AND created_at <
              clock_timestamp() - INTERVAL '15 minutes'
          )
        )
      ORDER BY created_at, id
      LIMIT 5
    `,
    [environment],
  );

  for (const run of result.rows) {
    await failRun(run, "NELO_AI_EXECUTION_EXPIRED", {
      recovery: true,
    });
  }
}

async function runNeloAIWorkerCycle() {
  const environment = getEnvironment();

  await recoverAbandonedRuns(environment);

  const run = await claimRun(environment);

  if (!run) return;

  try {
    // Ne pas traiter silencieusement une autre version de prompt.
    if (run.prompt_version !== "nelo-chat-v1") {
      throw workerError("NELO_AI_UNSUPPORTED_PROMPT_VERSION");
    }

    await setStep(run, "preparing_context");

    const context = await prepareNeloContext({
      runId: run.id,
      executionToken: run.execution_token,
    });

    await setStep(run, "generating_answer");

    const callId = await startCall(run);

    const outcome = await generateNeloAnswer({
      instructions: context.instructions,
      input: context.input,
    });

    await finishCall(callId, run, outcome);

    if (outcome.status !== "completed") {
      throw workerError(outcome.errorCode);
    }

    await setStep(run, "saving_answer");

    await completeRun(run, outcome.answer);

    console.info("[Nelo AI] completed", run.id);
  } catch (error) {
    const code = safeCode(error);

    // Journaliser avant failRun : une erreur de nettoyage
    // ne doit pas masquer l'erreur initiale.
    console.error("[Nelo AI] processing failed", {
      runId: run.id,
      code,
      errorName: error?.name,

      // Les messages des erreurs JavaScript permettent de repérer
      // une variable absente ou une fonction mal importée.
      message:
        error instanceof ReferenceError || error instanceof TypeError
          ? error.message
          : undefined,

      // Uniquement les emplacements du code, pas le payload.
      frames:
        typeof error?.stack === "string"
          ? error.stack
              .split("\n")
              .filter((line) => /^\s+at\s/.test(line))
              .slice(0, 8)
          : [],

      providerStatus: error?.$metadata?.httpStatusCode,
    });

    await failRun(run, code);
  }
}

module.exports = {
  runNeloAIWorkerCycle,
};
