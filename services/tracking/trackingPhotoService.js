const { randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("./trackingAccess");

const {
  uploadObject,
  deleteObject,
  createSignedDownloadUrl,
} = require("../storage/r2StorageService");

const { processTrackingImage } = require("../storage/trackingImageProcessor");

const MAX_PHOTOS = 10;

async function requireEntry(client, { childId, entryId }) {
  const result = await client.query(
    `
      SELECT id
      FROM tracking_entries
      WHERE id = $1
        AND child_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
    `,
    [entryId, childId],
  );

  if (result.rowCount === 0) {
    throw createTrackingError(
      "TRACKING_ENTRY_NOT_FOUND",
      "Tracking entry not found.",
      404,
    );
  }
}

async function readPhotos(database, entryId) {
  const result = await database.query(
    `
      SELECT
        a.*,
        link.sort_order
      FROM tracking_entry_attachments link
      INNER JOIN attachments a
        ON a.id = link.attachment_id
      WHERE link.tracking_entry_id = $1
        AND a.deleted_at IS NULL
      ORDER BY link.sort_order ASC, a.id ASC
    `,
    [entryId],
  );

  return result.rows;
}

async function mapPhoto(row) {
  return {
    id: row.id,
    attachmentId: row.id,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    url: await createSignedDownloadUrl({
      storageKey: row.storage_key,
    }),
    cacheKey: `tracking-photo:${row.id}`,
  };
}

async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Unable to roll back the tracking photo transaction:", {
      message: error.message,
    });
  }
}

async function cleanObject(storageKey) {
  try {
    await deleteObject(storageKey);
  } catch (error) {
    console.error("Unable to delete the tracking photo from R2:", {
      storageKey,
      message: error.message,
    });
  }
}

async function listTrackingPhotos({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  const client = await pool.connect();
  let rows;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    await requireEntry(client, { childId, entryId });

    rows = await readPhotos(client, entryId);

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  return Promise.all(rows.map(mapPhoto));
}

async function uploadTrackingPhoto({
  childId,
  userId,
  entryId,
  attachmentId,
  originalFilename,
  fileBuffer,
}) {
  validateUuid(entryId, "tracking entry ID");
  validateUuid(attachmentId, "attachment ID");

  const normalizedAttachmentId = attachmentId.toLowerCase();

  const client = await pool.connect();

  let uploadedStorageKey = null;
  let committed = false;
  let row;
  let created = false;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    // Sérialise les ajouts et suppressions de photos de cette entrée.
    await requireEntry(client, { childId, entryId });

    const existing = await client.query(
      `
        SELECT
          a.*,
          link.tracking_entry_id,
          link.sort_order
        FROM attachments a
        LEFT JOIN tracking_entry_attachments link
          ON link.attachment_id = a.id
        WHERE a.id = $1
      `,
      [normalizedAttachmentId],
    );

    if (existing.rowCount > 0) {
      const current = existing.rows[0];

      if (
        current.deleted_at ||
        current.tracking_entry_id !== entryId.toLowerCase() ||
        current.uploaded_by_user_id !== userId.toLowerCase()
      ) {
        throw createTrackingError(
          "ATTACHMENT_ID_CONFLICT",
          "This attachment ID is already used.",
          409,
        );
      }

      row = current;
    } else {
      const count = await client.query(
        `
          SELECT
            COUNT(*)::integer AS total,
            COALESCE(MAX(link.sort_order), -1)::integer AS last_order
          FROM tracking_entry_attachments link
          INNER JOIN attachments a
            ON a.id = link.attachment_id
          WHERE link.tracking_entry_id = $1
            AND a.deleted_at IS NULL
        `,
        [entryId],
      );

      if (count.rows[0].total >= MAX_PHOTOS) {
        throw createTrackingError(
          "TRACKING_PHOTO_LIMIT_REACHED",
          "A tracking entry must not contain more than 10 photos.",
          400,
        );
      }

      const image = await processTrackingImage(fileBuffer);

      // Une clé propre à cette tentative évite qu'un nettoyage
      // supprime le fichier d'une autre tentative concurrente.
      const storageKey =
        `children/${childId}/tracking/${entryId}/` +
        `${normalizedAttachmentId}-${randomUUID()}.${image.extension}`;

      // Nettoyage tenté également si l'upload échoue après un envoi partiel.
      uploadedStorageKey = storageKey;

      await uploadObject({
        storageKey,
        body: image.buffer,
        mimeType: image.mimeType,
      });

      const inserted = await client.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
        [
          normalizedAttachmentId,
          storageKey,
          originalFilename ? originalFilename.slice(0, 255) : null,
          image.mimeType,
          image.sizeBytes,
          image.width,
          image.height,
          userId,
        ],
      );

      const sortOrder = count.rows[0].last_order + 1;

      await client.query(
        `
          INSERT INTO tracking_entry_attachments (
            tracking_entry_id,
            attachment_id,
            sort_order
          )
          VALUES ($1, $2, $3)
        `,
        [entryId, normalizedAttachmentId, sortOrder],
      );

      await client.query(
        `
          UPDATE tracking_entries
          SET
            updated_at = clock_timestamp(),
            updated_by_user_id = $2,
            version = version + 1
          WHERE id = $1
        `,
        [entryId, userId],
      );

      row = {
        ...inserted.rows[0],
        sort_order: sortOrder,
      };

      created = true;
    }

    const versionResult = await client.query(
      `
        SELECT version
        FROM tracking_entries
        WHERE id = $1
      `,
      [entryId],
    );

    await client.query("COMMIT");
    committed = true;

    row.entryVersion = versionResult.rows[0].version;
  } catch (error) {
    await rollback(client);

    if (uploadedStorageKey && !committed) {
      await cleanObject(uploadedStorageKey);
    }

    if (error.code === "23505" && error.constraint === "attachments_pkey") {
      throw createTrackingError(
        "ATTACHMENT_ID_CONFLICT",
        "This attachment ID is already used.",
        409,
      );
    }

    throw error;
  } finally {
    client.release();
  }

  // La signature est faite après le commit.
  // Son échec ne supprime pas une photo déjà enregistrée.
  return {
    created,
    entryVersion: row.entryVersion,
    photo: await mapPhoto(row),
  };
}

async function deleteTrackingPhoto({ childId, userId, entryId, attachmentId }) {
  validateUuid(entryId, "tracking entry ID");
  validateUuid(attachmentId, "attachment ID");

  const client = await pool.connect();

  let storageKey = null;
  let removed = false;
  let entryVersion;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    await requireEntry(client, { childId, entryId });

    const result = await client.query(
      `
        SELECT a.id, a.storage_key
        FROM tracking_entry_attachments link
        INNER JOIN attachments a
          ON a.id = link.attachment_id
        WHERE link.tracking_entry_id = $1
          AND link.attachment_id = $2
          AND a.deleted_at IS NULL
        FOR UPDATE OF a
      `,
      [entryId, attachmentId],
    );

    if (result.rowCount > 0) {
      storageKey = result.rows[0].storage_key;

      await client.query(
        `
          UPDATE attachments
          SET deleted_at = clock_timestamp()
          WHERE id = $1
        `,
        [attachmentId],
      );

      await client.query(
        `
          DELETE FROM tracking_entry_attachments
          WHERE tracking_entry_id = $1
            AND attachment_id = $2
        `,
        [entryId, attachmentId],
      );

      await client.query(
        `
          UPDATE tracking_entries
          SET
            updated_at = clock_timestamp(),
            updated_by_user_id = $2,
            version = version + 1
          WHERE id = $1
        `,
        [entryId, userId],
      );

      removed = true;
    }

    const versionResult = await client.query(
      "SELECT version FROM tracking_entries WHERE id = $1",
      [entryId],
    );

    entryVersion = versionResult.rows[0].version;

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  if (storageKey) {
    await cleanObject(storageKey);
  }

  return { removed, entryVersion };
}

module.exports = {
  listTrackingPhotos,
  uploadTrackingPhoto,
  deleteTrackingPhoto,
};
