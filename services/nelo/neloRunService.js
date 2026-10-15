const pool = require("../../db/pool");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw serviceError("INVALID_REQUEST", `A valid ${label} is required.`, 400);
  }

  return value.toLowerCase();
}

function mapMessage(row) {
  if (!row) return null;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequenceNumber: String(row.sequence_number),
    role: row.role,
    content: row.content,
    suggestions: row.suggestions,
    sources: row.sources,
    createdAt: row.created_at,
  };
}

async function getRun({ childId, userId, runId }) {
  childId = normalizeUuid(childId, "child ID");
  userId = normalizeUuid(userId, "user ID");
  runId = normalizeUuid(runId, "run ID");

  const environment = process.env.BILLING_ENVIRONMENT;

  if (!["sandbox", "production"].includes(environment)) {
    throw serviceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  const result = await pool.query(
    `
      SELECT
        r.id,
        r.conversation_id,
        r.user_message_id,
        r.assistant_message_id,
        r.status,
        r.current_step,
        r.error_code,
        r.created_at,
        r.started_at,
        r.finished_at,
        clock_timestamp() AS server_time,

        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'sequenceNumber', s.sequence_number,
                'code', s.step_code,
                'status', s.status,
                'startedAt', s.started_at,
                'finishedAt', s.finished_at,
                'errorCode', s.error_code
              )
              ORDER BY s.sequence_number
            )
            FROM nelo_ai_run_steps s
            WHERE s.run_id = r.id
          ),
          '[]'::jsonb
        ) AS steps,

        (
          SELECT jsonb_build_object(
            'id', m.id,
            'conversation_id', m.conversation_id,
            'sequence_number', m.sequence_number::text,
            'role', m.role,
            'content', m.content,
            'suggestions', m.suggestions,
            'sources', m.sources,
            'created_at', m.created_at
          )
          FROM nelo_messages m
          WHERE m.id = r.assistant_message_id
            AND m.conversation_id = r.conversation_id
            AND m.role = 'assistant'
            AND r.status = 'completed'
        ) AS assistant_message

      FROM nelo_ai_runs r

      JOIN nelo_conversations nc
        ON nc.id = r.conversation_id
        AND nc.user_id = r.user_id
        AND nc.family_id = r.family_id
        AND nc.child_id = r.child_id
        AND nc.deleted_at IS NULL

      JOIN children c
        ON c.id = nc.child_id
        AND c.family_id = nc.family_id
        AND c.deleted_at IS NULL

      JOIN families f
        ON f.id = c.family_id
        AND f.deleted_at IS NULL

      WHERE r.id = $3::uuid
        AND r.child_id = $1::uuid
        AND r.user_id = $2::uuid
        AND r.environment = $4

        AND EXISTS (
          SELECT 1
          FROM children_members cm

          JOIN family_members fm
            ON fm.id = cm.family_member_id
            AND fm.family_id = c.family_id
            AND fm.removed_at IS NULL

          JOIN users u
            ON u.id = fm.user_id
            AND u.deleted_at IS NULL
            AND u.status = 'active'

          WHERE cm.child_id = c.id
            AND cm.revoked_at IS NULL
            AND fm.user_id = $2::uuid
        )
    `,
    [childId, userId, runId, environment],
  );

  if (result.rowCount !== 1) {
    throw serviceError(
      "NELO_RUN_NOT_FOUND",
      "The response could not be found.",
      404,
    );
  }

  const row = result.rows[0];

  if (row.status === "completed" && !row.assistant_message) {
    throw serviceError(
      "NELO_RUN_STATE_INCONSISTENT",
      "The response processing state is inconsistent.",
      500,
    );
  }

  const isFinished = ["completed", "failed", "cancelled"].includes(row.status);

  return {
    run: {
      id: row.id,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      status: row.status,
      currentStep: row.current_step,
      errorCode: row.error_code,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      steps: row.steps,
    },

    assistantMessage: mapMessage(row.assistant_message),

    // Indication pour le frontend, pas un timer exécuté côté serveur.
    pollAfterMs: isFinished ? null : 2000,

    serverTime: row.server_time,
  };
}

module.exports = {
  getRun,
};
