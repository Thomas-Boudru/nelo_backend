const pool = require("../../db/pool");

const { reserveFeatureUsage } = require("../billing/featureUsageService");

const { requireNeloPhotoAccess } = require("./neloPhotoAccessService");

const {
  prepareMessagePhoto,
  uploadMessagePhoto,
  cleanupMessagePhoto,
  insertMessagePhoto,
  readMessagePhotoRows,
  matchesMessagePhoto,
  mapMessagePhotos,
} = require("./neloMessagePhotoService");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED_LOCALES = new Set(["en", "fr", "de", "es", "it", "nl", "pt"]);

const PROMPT_VERSION = "nelo-chat-v1";

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

function validateMessage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw serviceError("INVALID_MESSAGE", "The message data is required.", 400);
  }

  const allowedFields = new Set([
    "clientMessageId",
    "content",
    "inputMode",
    "locale",
    "timezone",
    "attachmentIds",
  ]);

  if (Object.keys(data).some((key) => !allowedFields.has(key))) {
    throw serviceError(
      "INVALID_MESSAGE",
      "The message contains unsupported fields.",
      400,
    );
  }

  const clientMessageId = normalizeUuid(
    data.clientMessageId,
    "client message ID",
  );

  if (
    typeof data.content !== "string" ||
    !data.content.trim() ||
    data.content.length > 8000 ||
    data.content.includes("\u0000")
  ) {
    throw serviceError(
      "INVALID_MESSAGE_CONTENT",
      "The message must contain between 1 and 8000 characters.",
      400,
    );
  }

  const inputMode = data.inputMode ?? "text";

  if (!["text", "suggestion"].includes(inputMode)) {
    throw serviceError(
      "UNSUPPORTED_MESSAGE_INPUT",
      "Only text messages and suggestions are currently supported.",
      400,
    );
  }

  const locale = data.locale ?? "en";

  if (typeof locale !== "string" || !SUPPORTED_LOCALES.has(locale)) {
    throw serviceError(
      "INVALID_MESSAGE_LOCALE",
      "The message language is not supported.",
      400,
    );
  }

  const timezone = data.timezone ?? "UTC";

  if (
    typeof timezone !== "string" ||
    !timezone.trim() ||
    timezone.length > 100
  ) {
    throw serviceError(
      "INVALID_TIMEZONE",
      "A valid timezone is required.",
      400,
    );
  }

  let normalizedTimezone;

  try {
    normalizedTimezone = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
  } catch {
    throw serviceError(
      "INVALID_TIMEZONE",
      "A valid timezone is required.",
      400,
    );
  }

  if (
    data.attachmentIds !== undefined &&
    (!Array.isArray(data.attachmentIds) || data.attachmentIds.length !== 0)
  ) {
    throw serviceError(
      "CHAT_ATTACHMENTS_NOT_AVAILABLE",
      "Chat attachments are not available yet.",
      400,
    );
  }

  return {
    clientMessageId,
    content: data.content.trim(),
    inputMode,
    locale,
    timezone: normalizedTimezone,
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

function mapRun(row) {
  return {
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
  };
}

async function sendMessage({
  childId,
  userId,
  conversationId,
  data,
  photoFile = null,
}) {
  childId = normalizeUuid(childId, "child ID");
  userId = normalizeUuid(userId, "user ID");
  conversationId = normalizeUuid(conversationId, "conversation ID");

  const messageData = validateMessage(data);

  const environment = process.env.BILLING_ENVIRONMENT;

  if (!["sandbox", "production"].includes(environment)) {
    throw serviceError(
      "INVALID_BILLING_ENVIRONMENT",
      "The billing environment is not configured correctly.",
      500,
    );
  }

  let photo = null;

  if (photoFile) {
    // Contrôle également effectué ici pour protéger les appels
    // directs au service, indépendamment de la route Express.
    await requireNeloPhotoAccess({
      childId,
      conversationId,
      userId,
    });

    photo = await prepareMessagePhoto({
      childId,
      conversationId,
      fileBuffer: photoFile.buffer,
    });
  }

  let client = null;
  let transactionStarted = false;

  let uploadAttempted = false;

  // Vrai dès qu'un COMMIT susceptible de référencer notre fichier
  // a été envoyé. Une erreur réseau à ce moment est ambiguë.
  let photoCommitAttempted = false;
  let photoCommitted = false;

  try {
    if (photo) {
      uploadAttempted = true;
      await uploadMessagePhoto(photo);
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    /*
     * Première lecture pour déterminer la famille et vérifier l'accès.
     * Les permissions sont revérifiées après acquisition du verrou.
     */
    const access = await client.query(
      `
        SELECT c.family_id
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
      `,
      [childId, userId],
    );

    if (access.rowCount !== 1) {
      throw serviceError(
        "CHILD_NOT_FOUND",
        "The child could not be found.",
        404,
      );
    }

    const familyId = access.rows[0].family_id;

    // Ordre commun : famille, puis conversation.
    const family = await client.query(
      `
        SELECT id
        FROM families
        WHERE id = $1::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [familyId],
    );

    if (family.rowCount !== 1) {
      throw serviceError(
        "CHILD_NOT_FOUND",
        "The child could not be found.",
        404,
      );
    }

    /*
     * Verrouille aussi les associations d'accès pendant cette courte
     * transaction. Une révocation concurrente ne peut pas passer
     * entre cette vérification et l'enregistrement du message.
     */
    const membership = await client.query(
      `
        SELECT cm.id
        FROM children c

        JOIN children_members cm
          ON cm.child_id = c.id
          AND cm.revoked_at IS NULL

        JOIN family_members fm
          ON fm.id = cm.family_member_id
          AND fm.family_id = c.family_id
          AND fm.removed_at IS NULL

        JOIN users u
          ON u.id = fm.user_id
          AND u.deleted_at IS NULL
          AND u.status = 'active'

        WHERE c.id = $1::uuid
          AND c.family_id = $2::uuid
          AND c.deleted_at IS NULL
          AND fm.user_id = $3::uuid

        ORDER BY cm.id
        LIMIT 1
        FOR SHARE OF c, cm, fm, u
      `,
      [childId, familyId, userId],
    );

    if (membership.rowCount !== 1) {
      throw serviceError(
        "CHILD_NOT_FOUND",
        "The child could not be found.",
        404,
      );
    }

    const conversationResult = await client.query(
      `
        SELECT id, status, next_message_sequence
        FROM nelo_conversations
        WHERE id = $1::uuid
          AND child_id = $2::uuid
          AND user_id = $3::uuid
          AND family_id = $4::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [conversationId, childId, userId, familyId],
    );

    if (conversationResult.rowCount !== 1) {
      throw serviceError(
        "CONVERSATION_NOT_FOUND",
        "The conversation could not be found.",
        404,
      );
    }

    const conversation = conversationResult.rows[0];

    /*
     * Une nouvelle tentative du même message retourne le traitement
     * existant, sans créer un message ni réserver une unité de plus.
     */
    const existingMessage = await client.query(
      `
        SELECT *
        FROM nelo_messages
        WHERE conversation_id = $1::uuid
          AND client_message_id = $2::uuid
      `,
      [conversationId, messageData.clientMessageId],
    );

    if (existingMessage.rowCount > 0) {
      const savedMessage = existingMessage.rows[0];

      const existingRun = await client.query(
        `
          SELECT *
          FROM nelo_ai_runs
          WHERE user_message_id = $1::uuid
        `,
        [savedMessage.id],
      );

      if (existingRun.rowCount !== 1) {
        throw serviceError(
          "NELO_MESSAGE_STATE_INCONSISTENT",
          "The message processing state is inconsistent.",
          500,
        );
      }

      const savedRun = existingRun.rows[0];

      const savedPhotoRows = await readMessagePhotoRows({
        database: client,
        messageId: savedMessage.id,
      });

      const samePhoto = matchesMessagePhoto(savedPhotoRows, photo);

      if (
        savedMessage.role !== "user" ||
        savedMessage.content !== messageData.content ||
        savedMessage.input_mode !== messageData.inputMode ||
        savedRun.locale !== messageData.locale ||
        savedRun.timezone !== messageData.timezone ||
        savedRun.environment !== environment ||
        !samePhoto
      ) {
        throw serviceError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "This message ID belongs to another request.",
          409,
        );
      }

      const attachments = await mapMessagePhotos(savedPhotoRows);

      await client.query("COMMIT");
      transactionStarted = false;

      return {
        replayed: true,

        message: {
          ...mapMessage(savedMessage),
          attachments,
        },

        run: mapRun(savedRun),
      };
    }

    if (conversation.status !== "active") {
      throw serviceError(
        "CONVERSATION_ARCHIVED",
        "This conversation is archived.",
        409,
      );
    }

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
        "NELO_RESPONSE_IN_PROGRESS",
        "Please wait for the current response before sending another message.",
        409,
      );
    }

    if (photo) {
      // Les droits peuvent avoir changé pendant l'upload.
      // Vérification sur la même connexion que la réservation.
      await requireNeloPhotoAccess({
        childId,
        conversationId,
        userId,
        database: client,
      });
    }

    const usage = await reserveFeatureUsage({
      familyId,
      userId,
      featureCode: "assistant",
      idempotencyKey: messageData.clientMessageId,
      units: 1,

      requestData: {
        kind: "nelo_chat_message",
        childId,
        conversationId,
        content: messageData.content,
        inputMode: messageData.inputMode,
        locale: messageData.locale,
        timezone: messageData.timezone,
        attachmentIds: [],
        ...(photo
          ? {
              photoFingerprint: photo.fingerprint,
            }
          : {}),
      },

      transactionClient: client,
    });

    /*
     * Ici, aucun message n'existait. Une réservation déjà existante
     * serait donc incohérente : ne pas la réutiliser silencieusement.
     */
    if (usage.replayed || usage.status !== "reserved") {
      throw serviceError(
        "NELO_USAGE_STATE_INCONSISTENT",
        "The message quota reservation is inconsistent.",
        409,
      );
    }

    const savedMessage = await client.query(
      `
        INSERT INTO nelo_messages (
          conversation_id,
          sequence_number,
          role,
          client_message_id,
          content,
          input_mode
        )
        VALUES (
          $1::uuid,
          $2::bigint,
          'user',
          $3::uuid,
          $4,
          $5
        )
        RETURNING *
      `,
      [
        conversationId,
        conversation.next_message_sequence,
        messageData.clientMessageId,
        messageData.content,
        messageData.inputMode,
      ],
    );

    if (photo) {
      await insertMessagePhoto({
        database: client,
        messageId: savedMessage.rows[0].id,
        userId,
        photo,
      });
    }

    await client.query(
      `
        UPDATE nelo_conversations
        SET
          next_message_sequence = next_message_sequence + 1,
          last_message_at = NOW(),
          updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [conversationId],
    );

    const savedRun = await client.query(
      `
        INSERT INTO nelo_ai_runs (
          conversation_id,
          user_id,
          family_id,
          child_id,
          environment,
          usage_operation_id,
          user_message_id,
          locale,
          timezone,
          prompt_version
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6::uuid,
          $7::uuid,
          $8,
          $9,
          $10
        )
        RETURNING *
      `,
      [
        conversationId,
        userId,
        familyId,
        childId,
        environment,
        usage.operationId,
        savedMessage.rows[0].id,
        messageData.locale,
        messageData.timezone,
        PROMPT_VERSION,
      ],
    );

    const photoRows = await readMessagePhotoRows({
      database: client,
      messageId: savedMessage.rows[0].id,
    });

    const attachments = await mapMessagePhotos(photoRows);

    photoCommitAttempted = Boolean(photo);

    await client.query("COMMIT");

    transactionStarted = false;
    photoCommitted = Boolean(photo);

    return {
      replayed: false,

      message: {
        ...mapMessage(savedMessage.rows[0]),
        attachments,
      },

      run: mapRun(savedRun.rows[0]),
    };
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (photoCommitAttempted && !photoCommitted) {
      // Ne pas supprimer un fichier potentiellement référencé
      // par une transaction dont le COMMIT a réellement réussi.
      console.error("[Nelo photo] Commit outcome requires verification", {
        attachmentId: photo?.attachmentId,
      });
    }

    throw error;
  } finally {
    client?.release();

    if (uploadAttempted && !photoCommitted && !photoCommitAttempted) {
      await cleanupMessagePhoto(photo);
    }
  }
}

module.exports = {
  sendMessage,
};
