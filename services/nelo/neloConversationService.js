const pool = require("../../db/pool");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw serviceError("INVALID_REQUEST", `A valid ${field} is required.`, 400);
  }

  return value.toLowerCase();
}

function parseInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;

  const text = String(value);

  if (!["string", "number"].includes(typeof value) || !/^\d+$/.test(text)) {
    throw serviceError(
      "INVALID_PAGINATION",
      "The pagination parameters are invalid.",
      400,
    );
  }

  const parsed = Number(text);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw serviceError(
      "INVALID_PAGINATION",
      "The pagination parameters are invalid.",
      400,
    );
  }

  return parsed;
}

function parseBeforeSequence(value) {
  if (value === undefined) return null;

  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw serviceError(
      "INVALID_MESSAGE_CURSOR",
      "The message cursor is invalid.",
      400,
    );
  }

  // Les bigint restent des chaînes pour éviter une perte de précision.
  return value;
}

// $1 = childId, $2 = userId.
// EXISTS évite les doublons si plusieurs associations sont présentes.
const ACCESS_CTE = `
  WITH accessible_child AS (
    SELECT c.id, c.family_id
    FROM children c

    JOIN families f
      ON f.id = c.family_id
      AND f.deleted_at IS NULL

    WHERE c.id = $1::uuid
      AND c.deleted_at IS NULL

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
  )
`;

function mapConversation(row) {
  return {
    id: row.id,
    childId: row.child_id,
    familyId: row.family_id,
    title: row.title,
    preview: row.preview ?? null,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequenceNumber: String(row.sequence_number),
    role: row.role,
    clientMessageId: row.client_message_id,
    content: row.content,
    inputMode: row.input_mode,
    suggestions: row.suggestions,
    sources: row.sources,
    createdAt: row.created_at,
  };
}

async function createConversation({ childId, userId, title = null }) {
  childId = validateUuid(childId, "child ID");
  userId = validateUuid(userId, "user ID");

  if (title !== null) {
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 200
    ) {
      throw serviceError(
        "INVALID_CONVERSATION_TITLE",
        "The conversation title must contain between 1 and 200 characters.",
        400,
      );
    }

    title = title.trim();
  }

  const result = await pool.query(
    `
      ${ACCESS_CTE}

      INSERT INTO nelo_conversations (
        user_id,
        family_id,
        child_id,
        title
      )
      SELECT
        $2::uuid,
        ac.family_id,
        ac.id,
        $3
      FROM accessible_child ac

      RETURNING
        id, child_id, family_id, title, status,
        last_message_at, created_at, updated_at
    `,
    [childId, userId, title],
  );

  if (result.rowCount === 0) {
    throw serviceError("CHILD_NOT_FOUND", "The child could not be found.", 404);
  }

  return mapConversation(result.rows[0]);
}

async function listConversations({ childId, userId, limit, offset }) {
  childId = validateUuid(childId, "child ID");
  userId = validateUuid(userId, "user ID");

  const pageSize = parseInteger(limit, 20, 1, 50);
  const pageOffset = parseInteger(offset, 0, 0, 100000);

  const result = await pool.query(
    `
      ${ACCESS_CTE}

      SELECT
        EXISTS (SELECT 1 FROM accessible_child) AS has_access,

        COALESCE(
          (
            SELECT jsonb_agg(
              to_jsonb(page)
              ORDER BY
                page.last_message_at DESC NULLS LAST,
                page.created_at DESC,
                page.id DESC
            )
            FROM (
              SELECT
                nc.id,
                nc.child_id,
                nc.family_id,
                COALESCE(
                nc.title,
                (
                  SELECT LEFT(m.content, 100)
                  FROM nelo_messages m
                  WHERE m.conversation_id = nc.id
                    AND m.role = 'user'
                  ORDER BY m.sequence_number ASC
                  LIMIT 1
                )
              ) AS title,

              (
                SELECT LEFT(m.content, 180)
                FROM nelo_messages m
                WHERE m.conversation_id = nc.id
                ORDER BY m.sequence_number DESC
                LIMIT 1
              ) AS preview,

              nc.status,
              nc.last_message_at,
              nc.created_at,
              nc.updated_at
              FROM nelo_conversations nc

              JOIN accessible_child ac
                ON ac.id = nc.child_id
                AND ac.family_id = nc.family_id

              WHERE nc.user_id = $2::uuid
                AND nc.deleted_at IS NULL
                AND nc.status = 'active'

              ORDER BY
                nc.last_message_at DESC NULLS LAST,
                nc.created_at DESC,
                nc.id DESC

              LIMIT $3
              OFFSET $4
            ) page
          ),
          '[]'::jsonb
        ) AS conversations
    `,
    [childId, userId, pageSize + 1, pageOffset],
  );

  const row = result.rows[0];

  if (!row.has_access) {
    throw serviceError("CHILD_NOT_FOUND", "The child could not be found.", 404);
  }

  const hasMore = row.conversations.length > pageSize;

  return {
    conversations: row.conversations.slice(0, pageSize).map(mapConversation),

    pagination: {
      limit: pageSize,
      offset: pageOffset,
      hasMore,
      nextOffset: hasMore ? pageOffset + pageSize : null,
    },
  };
}

async function listMessages({
  childId,
  userId,
  conversationId,
  limit,
  beforeSequence,
}) {
  childId = validateUuid(childId, "child ID");
  userId = validateUuid(userId, "user ID");
  conversationId = validateUuid(conversationId, "conversation ID");

  const pageSize = parseInteger(limit, 30, 1, 100);
  const before = parseBeforeSequence(beforeSequence);

  const result = await pool.query(
    `
      ${ACCESS_CTE},

      accessible_conversation AS (
        SELECT
          nc.id,
          nc.child_id,
          nc.family_id,
          nc.title,
          nc.status,
          nc.last_message_at,
          nc.created_at,
          nc.updated_at
        FROM nelo_conversations nc

        JOIN accessible_child ac
          ON ac.id = nc.child_id
          AND ac.family_id = nc.family_id

        WHERE nc.id = $3::uuid
          AND nc.user_id = $2::uuid
          AND nc.deleted_at IS NULL
      )

      SELECT
        to_jsonb(ac) AS conversation,

        COALESCE(
          (
            SELECT jsonb_agg(
              to_jsonb(page)
              ORDER BY page.sequence_number::bigint DESC
            )
            FROM (
              SELECT
                m.id,
                m.conversation_id,
                m.sequence_number::text AS sequence_number,
                m.role,
                m.client_message_id,
                m.content,
                m.input_mode,
                m.suggestions,
                m.sources,
                m.created_at
              FROM nelo_messages m

              WHERE m.conversation_id = ac.id
                AND (
                  $4::bigint IS NULL
                  OR m.sequence_number < $4::bigint
                )

              ORDER BY m.sequence_number DESC
              LIMIT $5
            ) page
          ),
          '[]'::jsonb
        ) AS messages

      FROM accessible_conversation ac
    `,
    [childId, userId, conversationId, before, pageSize + 1],
  );

  if (result.rowCount === 0) {
    throw serviceError(
      "CONVERSATION_NOT_FOUND",
      "The conversation could not be found.",
      404,
    );
  }

  const row = result.rows[0];
  const hasMore = row.messages.length > pageSize;
  const page = row.messages.slice(0, pageSize);

  const oldestSequence =
    page.length > 0 ? String(page[page.length - 1].sequence_number) : null;

  return {
    conversation: mapConversation(row.conversation),

    // Chaque page est renvoyée dans l'ordre chronologique.
    messages: page.reverse().map(mapMessage),

    pagination: {
      limit: pageSize,
      hasMore,
      nextBeforeSequence: hasMore ? oldestSequence : null,
    },
  };
}

async function deleteConversation({ childId, userId, conversationId }) {
  childId = validateUuid(childId, "child ID");
  userId = validateUuid(userId, "user ID");
  conversationId = validateUuid(conversationId, "conversation ID");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        ${ACCESS_CTE}

        SELECT nc.id, nc.deleted_at
        FROM nelo_conversations nc

        JOIN accessible_child ac
          ON ac.id = nc.child_id
          AND ac.family_id = nc.family_id

        WHERE nc.id = $3::uuid
          AND nc.user_id = $2::uuid

        FOR UPDATE OF nc
      `,
      [childId, userId, conversationId],
    );

    if (result.rowCount === 0) {
      throw serviceError(
        "CONVERSATION_NOT_FOUND",
        "The conversation could not be found.",
        404,
      );
    }

    // Une nouvelle tentative de suppression reste sans effet secondaire.
    if (result.rows[0].deleted_at) {
      await client.query("COMMIT");
      return { removed: true };
    }

    /*
     * Le verrou de conversation empêche un nouvel envoi
     * de s'insérer pendant cette suppression.
     */
    const pendingRun = await client.query(
      `
        SELECT id
        FROM nelo_ai_runs
        WHERE conversation_id = $1::uuid
          AND status IN ('queued', 'running')
        LIMIT 1
      `,
      [conversationId],
    );

    if (pendingRun.rowCount > 0) {
      throw serviceError(
        "CONVERSATION_BUSY",
        "Wait for the current answer before deleting this conversation.",
        409,
      );
    }

    await client.query(
      `
        UPDATE nelo_conversations
        SET
          deleted_at = clock_timestamp(),
          updated_at = clock_timestamp()
        WHERE id = $1::uuid
      `,
      [conversationId],
    );

    await client.query("COMMIT");

    return { removed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createConversation,
  listConversations,
  listMessages,
  deleteConversation,
};
