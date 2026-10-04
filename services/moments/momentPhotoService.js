const { randomUUID } = require("node:crypto");

const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../tracking/trackingAccess");

const {
  uploadObject,
  deleteObject,
  createSignedDownloadUrl,
} = require("../storage/r2StorageService");

const { processTrackingImage } = require("../storage/trackingImageProcessor");

const MAX_PHOTOS = 6;

async function requireMoment(client, { childId, momentId }) {
  const result = await client.query(
    `
      SELECT id, moment_type, status, version
      FROM moments
      WHERE id = $1
        AND child_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
    `,
    [momentId, childId],
  );

  if (result.rowCount === 0) {
    throw createTrackingError("MOMENT_NOT_FOUND", "Moment not found.", 404);
  }

  return result.rows[0];
}

async function readPhotos(client, momentId) {
  const result = await client.query(
    `
      SELECT
        a.*,
        link.display_order
      FROM moment_attachments link
      INNER JOIN attachments a
        ON a.id = link.attachment_id
      WHERE link.moment_id = $1
        AND a.deleted_at IS NULL
      ORDER BY link.display_order ASC, a.id ASC
    `,
    [momentId],
  );

  return result.rows;
}

async function mapPhoto(row) {
  return {
    id: row.id,
    attachmentId: row.id,
    displayOrder: row.display_order,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    createdAt: new Date(row.created_at).toISOString(),

    url: await createSignedDownloadUrl({
      storageKey: row.storage_key,
    }),

    cacheKey: `moment-photo:${row.id}`,
  };
}

async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Unable to roll back the moment photo transaction:", {
      message: error.message,
    });
  }
}

async function cleanObject(storageKey) {
  try {
    await deleteObject(storageKey);
  } catch (error) {
    console.error("Unable to delete the moment photo from R2:", {
      storageKey,
      message: error.message,
    });
  }
}

async function incrementMomentVersion(client, { momentId, userId }) {
  const result = await client.query(
    `
      UPDATE moments
      SET
        updated_at = clock_timestamp(),
        updated_by_user_id = $2,
        version = version + 1
      WHERE id = $1
      RETURNING version
    `,
    [momentId, userId],
  );

  return result.rows[0].version;
}

async function normalizePhotoOrder(client, momentId) {
  // Autoriser temporairement les changements de position
  // avant de vérifier l'unicité des positions à la fin.
  await client.query(`
    SET CONSTRAINTS moment_attachments_order_unique DEFERRED
  `);

  await client.query(
    `
      WITH ordered_photos AS (
        SELECT
          attachment_id,
          (
            ROW_NUMBER() OVER (
              ORDER BY display_order ASC, attachment_id ASC
            ) - 1
          )::smallint AS next_order
        FROM moment_attachments
        WHERE moment_id = $1
      )
      UPDATE moment_attachments AS link
      SET display_order = ordered_photos.next_order
      FROM ordered_photos
      WHERE link.moment_id = $1
        AND link.attachment_id = ordered_photos.attachment_id
    `,
    [momentId],
  );

  await client.query(`
    SET CONSTRAINTS moment_attachments_order_unique IMMEDIATE
  `);
}

async function listMomentPhotos({ childId, userId, momentId }) {
  validateUuid(momentId, "moment ID");

  const client = await pool.connect();

  let rows;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    await requireMoment(client, {
      childId,
      momentId,
    });

    rows = await readPhotos(client, momentId);

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  return Promise.all(rows.map(mapPhoto));
}

async function uploadMomentPhoto({
  childId,
  userId,
  momentId,
  attachmentId,
  originalFilename,
  fileBuffer,
}) {
  validateUuid(momentId, "moment ID");
  validateUuid(attachmentId, "attachment ID");

  const normalizedAttachmentId = attachmentId.toLowerCase();

  const client = await pool.connect();

  let uploadedStorageKey = null;
  let commitAttempted = false;

  let photoRow;
  let created = false;
  let momentVersion;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    // Le même verrou est utilisé pour les modifications
    // et la publication du souvenir.
    const moment = await requireMoment(client, {
      childId,
      momentId,
    });

    if (moment.moment_type === "note") {
      throw createTrackingError(
        "NOTE_MOMENT_PHOTOS_NOT_ALLOWED",
        "Note moments cannot contain photos.",
        400,
      );
    }

    const existing = await client.query(
      `
        SELECT
          a.*,
          link.moment_id,
          link.display_order
        FROM attachments a
        LEFT JOIN moment_attachments link
          ON link.attachment_id = a.id
        WHERE a.id = $1
      `,
      [normalizedAttachmentId],
    );

    if (existing.rowCount > 0) {
      const current = existing.rows[0];

      if (
        current.deleted_at ||
        current.moment_id !== momentId.toLowerCase() ||
        current.uploaded_by_user_id !== userId.toLowerCase()
      ) {
        throw createTrackingError(
          "ATTACHMENT_ID_CONFLICT",
          "This attachment ID is already used.",
          409,
        );
      }

      // Une nouvelle tentative retourne la photo existante
      // sans renvoyer le fichier ni augmenter la version.
      photoRow = current;
      momentVersion = moment.version;
    } else {
      const photos = await readPhotos(client, momentId);

      if (photos.length >= MAX_PHOTOS) {
        throw createTrackingError(
          "MOMENT_PHOTO_LIMIT_REACHED",
          "A moment must not contain more than 6 photos.",
          400,
        );
      }

      const image = await processTrackingImage(fileBuffer);

      const storageKey =
        `children/${childId}/moments/${momentId}/` +
        `${normalizedAttachmentId}-${randomUUID()}.${image.extension}`;

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
          typeof originalFilename === "string"
            ? originalFilename.slice(0, 255)
            : null,
          image.mimeType,
          image.sizeBytes,
          image.width,
          image.height,
          userId,
        ],
      );

      // Compacter les positions avant d'ajouter en fin de liste.
      await normalizePhotoOrder(client, momentId);

      const orderResult = await client.query(
        `
          SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order
          FROM moment_attachments
          WHERE moment_id = $1
        `,
        [momentId],
      );

      const displayOrder = orderResult.rows[0].next_order;

      await client.query(
        `
          INSERT INTO moment_attachments (
            moment_id,
            attachment_id,
            display_order
          )
          VALUES ($1, $2, $3)
        `,
        [momentId, normalizedAttachmentId, displayOrder],
      );

      momentVersion = await incrementMomentVersion(client, {
        momentId,
        userId,
      });

      photoRow = {
        ...inserted.rows[0],
        display_order: displayOrder,
      };

      created = true;
    }

    commitAttempted = true;
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);

    if (uploadedStorageKey && !commitAttempted) {
      await cleanObject(uploadedStorageKey);
    }

    // Si COMMIT a été envoyé mais que sa réponse est perdue,
    // ne pas supprimer un fichier potentiellement enregistré.
    if (uploadedStorageKey && commitAttempted) {
      console.error("Moment photo commit outcome requires reconciliation:", {
        storageKey: uploadedStorageKey,
        momentId,
        attachmentId: normalizedAttachmentId,
        message: error.message,
      });
    }

    if (
      error.code === "23505" &&
      (error.constraint === "attachments_pkey" ||
        error.constraint === "moment_attachments_attachment_unique")
    ) {
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

  // La génération de l'URL a lieu après le commit :
  // un échec de signature n'annule pas la sauvegarde.
  return {
    created,
    momentVersion,
    photo: await mapPhoto(photoRow),
  };
}

async function deleteMomentPhoto({ childId, userId, momentId, attachmentId }) {
  validateUuid(momentId, "moment ID");
  validateUuid(attachmentId, "attachment ID");

  const client = await pool.connect();

  let storageKey = null;
  let removed = false;
  let momentVersion;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const moment = await requireMoment(client, {
      childId,
      momentId,
    });

    const result = await client.query(
      `
        SELECT
          a.id,
          a.storage_key,
          a.deleted_at
        FROM moment_attachments link
        INNER JOIN attachments a
          ON a.id = link.attachment_id
        WHERE link.moment_id = $1
          AND link.attachment_id = $2
        FOR UPDATE OF a
      `,
      [momentId, attachmentId],
    );

    const photo = result.rows[0];

    if (photo) {
      if (
        !photo.deleted_at &&
        moment.moment_type === "photo" &&
        moment.status === "published"
      ) {
        const activePhotos = await readPhotos(client, momentId);

        if (activePhotos.length <= 1) {
          throw createTrackingError(
            "LAST_MOMENT_PHOTO_REQUIRED",
            "Add another photo before removing the last photo of this moment.",
            409,
          );
        }
      }

      storageKey = photo.storage_key;

      await client.query(
        `
          UPDATE attachments
          SET deleted_at = COALESCE(deleted_at, clock_timestamp())
          WHERE id = $1
        `,
        [attachmentId],
      );

      await client.query(
        `
          DELETE FROM moment_attachments
          WHERE moment_id = $1
            AND attachment_id = $2
        `,
        [momentId, attachmentId],
      );

      await normalizePhotoOrder(client, momentId);

      momentVersion = await incrementMomentVersion(client, {
        momentId,
        userId,
      });

      removed = true;
    } else {
      // La photo n'est plus liée : une nouvelle tentative
      // ne modifie pas à nouveau le souvenir.
      momentVersion = moment.version;
    }

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  // Le fichier n'est supprimé qu'après validation de la transaction.
  if (storageKey) {
    await cleanObject(storageKey);
  }

  return {
    removed,
    momentVersion,
  };
}

module.exports = {
  listMomentPhotos,
  uploadMomentPhoto,
  deleteMomentPhoto,
};
