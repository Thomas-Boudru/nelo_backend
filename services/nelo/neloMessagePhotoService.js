const { createHash, randomUUID } = require("node:crypto");

const { processNeloPhoto } = require("./neloPhotoProcessor");

const {
  uploadObject,
  deleteObject,
  createSignedDownloadUrl,
} = require("../storage/r2StorageService");

function getPhotoFingerprint(fileBuffer) {
  return createHash("sha256").update(fileBuffer).digest("hex");
}

async function prepareMessagePhoto({ childId, conversationId, fileBuffer }) {
  const image = await processNeloPhoto(fileBuffer);

  const fingerprint = getPhotoFingerprint(fileBuffer);
  const attachmentId = randomUUID();

  return {
    attachmentId,
    fingerprint,
    image,

    // Identifiant unique par tentative : un nettoyage ne peut pas
    // supprimer le fichier d'une autre requête concurrente.
    storageKey:
      `nelo/conversations/${conversationId}/` +
      `${childId}/${attachmentId}/${fingerprint}.webp`,
  };
}

async function uploadMessagePhoto(photo) {
  await uploadObject({
    storageKey: photo.storageKey,
    body: photo.image.buffer,
    mimeType: photo.image.mimeType,
  });
}

async function cleanupMessagePhoto(photo) {
  if (!photo) return;

  try {
    await deleteObject(photo.storageKey);
  } catch {
    // Ne pas masquer l'erreur initiale.
    // Cette référence permettra un nettoyage ultérieur.
    console.error("[Nelo photo] Cleanup required", {
      attachmentId: photo.attachmentId,
    });
  }
}

async function insertMessagePhoto({ database, messageId, userId, photo }) {
  await database.query(
    `
      INSERT INTO attachments (
        id,
        storage_key,
        original_filename,
        mime_type,
        size_bytes,
        width,
        height,
        uploaded_by_user_id
      )
      VALUES (
        $1::uuid,
        $2::text,
        'photo.webp',
        $3::varchar,
        $4::bigint,
        $5::integer,
        $6::integer,
        $7::uuid
      )
    `,
    [
      photo.attachmentId,
      photo.storageKey,
      photo.image.mimeType,
      photo.image.sizeBytes,
      photo.image.width,
      photo.image.height,
      userId,
    ],
  );

  await database.query(
    `
      INSERT INTO nelo_message_attachments (
        message_id,
        attachment_id,
        display_order
      )
      VALUES ($1::uuid, $2::uuid, 0)
    `,
    [messageId, photo.attachmentId],
  );
}

// Fonction interne : l'appelant doit avoir vérifié
// l'autorisation d'accès à la conversation.
async function readMessagePhotoRows({ database, messageId }) {
  const result = await database.query(
    `
      SELECT
        a.id,
        a.storage_key,
        a.mime_type,
        a.size_bytes,
        a.width,
        a.height,
        a.deleted_at,
        ma.display_order

      FROM nelo_message_attachments ma

      JOIN attachments a
        ON a.id = ma.attachment_id

      WHERE ma.message_id = $1::uuid

      ORDER BY ma.display_order, a.id
    `,
    [messageId],
  );

  return result.rows;
}

function matchesMessagePhoto(rows, photo) {
  if (!photo) {
    return rows.length === 0;
  }

  return (
    rows.length === 1 &&
    rows[0].storage_key.endsWith(`/${photo.fingerprint}.webp`)
  );
}

async function mapMessagePhotos(rows) {
  return Promise.all(
    rows
      .filter((row) => !row.deleted_at)
      .map(async (row) => ({
        id: row.id,
        attachmentId: row.id,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        displayOrder: row.display_order,

        url: await createSignedDownloadUrl({
          storageKey: row.storage_key,
        }),

        cacheKey: `nelo-photo:${row.id}`,
      })),
  );
}

// Fonction interne.
// L'appelant doit avoir autorisé l'accès à la conversation.
async function loadPhotosForMessages({
  database,
  conversationId,
  userId,
  messageIds,
}) {
  if (messageIds.length === 0) {
    return new Map();
  }

  const result = await database.query(
    `
      SELECT
        ma.message_id,
        ma.display_order,

        a.id,
        a.storage_key,
        a.mime_type,
        a.size_bytes,
        a.width,
        a.height,
        a.deleted_at

      FROM nelo_message_attachments ma

      JOIN nelo_messages m
        ON m.id = ma.message_id

      JOIN nelo_conversations nc
        ON nc.id = m.conversation_id

      JOIN attachments a
        ON a.id = ma.attachment_id

      WHERE nc.id = $1::uuid
        AND nc.user_id = $2::uuid
        AND nc.deleted_at IS NULL

        AND m.id = ANY($3::uuid[])
        AND m.role = 'user'

        AND a.uploaded_by_user_id = $2::uuid
        AND a.deleted_at IS NULL

      ORDER BY
        ma.message_id,
        ma.display_order,
        a.id
    `,
    [conversationId, userId, messageIds],
  );

  const rowsByMessage = new Map();

  for (const row of result.rows) {
    const rows = rowsByMessage.get(row.message_id) ?? [];

    rows.push(row);
    rowsByMessage.set(row.message_id, rows);
  }

  const entries = await Promise.all(
    [...rowsByMessage.entries()].map(async ([messageId, rows]) => [
      messageId,
      await mapMessagePhotos(rows),
    ]),
  );

  return new Map(entries);
}

module.exports = {
  prepareMessagePhoto,
  uploadMessagePhoto,
  cleanupMessagePhoto,
  insertMessagePhoto,
  readMessagePhotoRows,
  matchesMessagePhoto,
  mapMessagePhotos,
  loadPhotosForMessages,
};
