const { randomUUID } = require("crypto");

const pool = require("../../db/pool");

const {
  createSignedDownloadUrl,
  deleteObject,
  uploadObject,
} = require("../storage/r2StorageService");

const { processAvatarImage } = require("../storage/avatarImageProcessor");

function createServiceError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

async function getEditableChild(client, { childId, userId }) {
  const result = await client.query(
    `
      SELECT
        c.id,
        c.avatar_attachment_id,
        previous_avatar.storage_key AS previous_avatar_storage_key

      FROM children c

      INNER JOIN family_members fm
        ON fm.family_id = c.family_id
        AND fm.user_id = $2
        AND fm.removed_at IS NULL

      INNER JOIN children_members cm
        ON cm.child_id = c.id
        AND cm.family_member_id = fm.id
        AND cm.revoked_at IS NULL
        AND cm.child_role IN ('owner', 'contributor')

      LEFT JOIN attachments previous_avatar
        ON previous_avatar.id = c.avatar_attachment_id
        AND previous_avatar.deleted_at IS NULL

      WHERE c.id = $1
        AND c.deleted_at IS NULL

      FOR UPDATE OF c
    `,
    [childId, userId],
  );

  if (result.rowCount === 0) {
    throw createServiceError(
      "CHILD_NOT_FOUND_OR_FORBIDDEN",
      "The child does not exist or cannot be modified by this user.",
      404,
    );
  }

  return result.rows[0];
}

async function saveChildAvatar({
  childId,
  userId,
  originalFilename,
  fileBuffer,
}) {
  if (!childId) {
    throw createServiceError("MISSING_CHILD_ID", "Missing child ID.", 400);
  }

  if (!userId) {
    throw createServiceError("MISSING_USER_ID", "Missing user ID.", 400);
  }

  const processedImage = await processAvatarImage(fileBuffer);

  const attachmentId = randomUUID();
  const storageKey = `children/${childId}/avatars/${attachmentId}.${processedImage.extension}`;

  let newObjectWasUploaded = false;
  let previousAvatarStorageKey = null;
  const client = await pool.connect();

  try {
    await uploadObject({
      storageKey,
      body: processedImage.buffer,
      mimeType: processedImage.mimeType,
    });

    newObjectWasUploaded = true;

    await client.query("BEGIN");

    const child = await getEditableChild(client, {
      childId,
      userId,
    });

    previousAvatarStorageKey = child.previous_avatar_storage_key;

    await client.query(
      `
        INSERT INTO attachments (
          id,
          storage_key,
          original_filename,
          mime_type,
          size_bytes,
          width,
          height,
          uploaded_by_user_id,
          created_at,
          deleted_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          NOW(),
          NULL
        )
      `,
      [
        attachmentId,
        storageKey,
        originalFilename || null,
        processedImage.mimeType,
        processedImage.sizeBytes,
        processedImage.width,
        processedImage.height,
        userId,
      ],
    );

    await client.query(
      `
        UPDATE children
        SET
          avatar_attachment_id = $1,
          updated_by_user_id = $2,
          updated_at = NOW()
        WHERE id = $3
      `,
      [attachmentId, userId, childId],
    );

    if (child.avatar_attachment_id) {
      await client.query(
        `
          UPDATE attachments
          SET deleted_at = NOW()
          WHERE id = $1
            AND deleted_at IS NULL
        `,
        [child.avatar_attachment_id],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to roll back the avatar transaction:", {
        message: rollbackError.message,
      });
    }

    if (newObjectWasUploaded) {
      try {
        await deleteObject(storageKey);
      } catch (cleanupError) {
        console.error("Unable to clean up the new R2 avatar:", {
          attachmentId,
          message: cleanupError.message,
        });
      }
    }

    throw error;
  } finally {
    client.release();
  }

  if (previousAvatarStorageKey && previousAvatarStorageKey !== storageKey) {
    try {
      await deleteObject(previousAvatarStorageKey);
    } catch (error) {
      console.error("Unable to delete the previous R2 avatar:", {
        childId,
        message: error.message,
      });
    }
  }

  const url = await createSignedDownloadUrl({
    storageKey,
  });

  return {
    attachmentId,
    url,
    cacheKey: `child-avatar:${childId}:${attachmentId}`,
  };
}

module.exports = {
  saveChildAvatar,
};
