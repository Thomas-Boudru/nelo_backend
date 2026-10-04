const pool = require("../../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../trackingAccess");

const { listTrackingPhotos } = require("../trackingPhotoService");

const MAX_NOTE_LENGTH = 10000;

function validateData(data, { update = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createTrackingError("INVALID_NOTE_ENTRY", "Invalid note entry.", 400);
  }

  if (typeof data.note !== "string") {
    throw createTrackingError(
      "INVALID_NOTE_TEXT",
      "The note must be text.",
      400,
    );
  }

  if (data.note.length > MAX_NOTE_LENGTH) {
    throw createTrackingError(
      "NOTE_TOO_LONG",
      "The note must not exceed 10000 characters.",
      400,
    );
  }

  // Les requêtes doivent utiliser une date ISO avec un fuseau horaire.
  if (
    typeof data.notedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(data.notedAt) ||
    !Number.isFinite(Date.parse(data.notedAt))
  ) {
    throw createTrackingError("INVALID_NOTE_DATE", "Invalid note date.", 400);
  }

  if (update && (!Number.isSafeInteger(data.version) || data.version < 1)) {
    throw createTrackingError(
      "INVALID_TRACKING_VERSION",
      "Invalid tracking entry version.",
      400,
    );
  }

  return {
    // Conserver les retours à la ligne et les espaces saisis.
    note: data.note,
    notedAt: new Date(data.notedAt).toISOString(),
    ...(update ? { version: data.version } : {}),
  };
}

function toIso(value) {
  return new Date(value).toISOString();
}

function mapEntry(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: row.entry_type,
    note: row.note_text ?? "",
    notedAt: toIso(row.started_at),
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    source: row.source,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    version: row.version,
  };
}

function hasSameContent(row, data) {
  return (
    (row.note_text ?? "") === data.note &&
    toIso(row.started_at) === data.notedAt
  );
}

function throwNotFound() {
  throw createTrackingError(
    "TRACKING_ENTRY_NOT_FOUND",
    "Tracking entry not found.",
    404,
  );
}

function throwVersionConflict() {
  throw createTrackingError(
    "TRACKING_VERSION_CONFLICT",
    "This tracking entry has been modified. Reload it before trying again.",
    409,
  );
}

async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Unable to roll back the note transaction:", {
      message: error.message,
    });
  }
}

async function getNoteEntry({ childId, userId, entryId }) {
  validateUuid(entryId, "tracking entry ID");

  const client = await pool.connect();

  let entry;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    const result = await client.query(
      `
        SELECT *
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'note'
          AND deleted_at IS NULL
      `,
      [entryId, childId],
    );

    if (result.rowCount === 0) {
      throwNotFound();
    }

    entry = mapEntry(result.rows[0]);

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  // Le service photos vérifie également les droits d'accès.
  const photos = await listTrackingPhotos({
    childId,
    userId,
    entryId,
  });

  return {
    ...entry,
    photos,
  };
}

async function createNoteEntry({ childId, userId, data }) {
  const normalized = validateData(data);

  // L'identifiant est généré sur le téléphone pour permettre
  // les nouvelles tentatives sans créer de doublons.
  validateUuid(data.id, "tracking entry ID");

  const entryId = data.id.toLowerCase();

  const client = await pool.connect();

  let entry;
  let created = false;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const inserted = await client.query(
      `
        INSERT INTO tracking_entries (
          id,
          child_id,
          entry_type,
          started_at,
          note_text,
          source,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at,
          version
        )
        VALUES (
          $1,
          $2,
          'note',
          $3,
          $4,
          'manual',
          $5,
          $5,
          clock_timestamp(),
          clock_timestamp(),
          1
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `,
      [entryId, childId, normalized.notedAt, normalized.note, userId],
    );

    if (inserted.rowCount > 0) {
      entry = mapEntry(inserted.rows[0]);
      created = true;
    } else {
      // Une précédente tentative a pu être enregistrée
      // alors que sa réponse n'est pas arrivée au téléphone.
      const existing = await client.query(
        `
          SELECT *
          FROM tracking_entries
          WHERE id = $1
            AND child_id = $2
            AND entry_type = 'note'
          FOR UPDATE
        `,
        [entryId, childId],
      );

      const current = existing.rows[0];

      if (
        !current ||
        current.deleted_at ||
        current.source !== "manual" ||
        current.created_by_user_id !== userId.toLowerCase() ||
        !hasSameContent(current, normalized)
      ) {
        throw createTrackingError(
          "TRACKING_ENTRY_ID_CONFLICT",
          "This tracking entry ID is already used.",
          409,
        );
      }

      entry = mapEntry(current);
    }

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  return {
    created,
    entry,
  };
}

async function updateNoteEntry({ childId, userId, entryId, data }) {
  validateUuid(entryId, "tracking entry ID");

  const normalized = validateData(data, { update: true });

  const client = await pool.connect();

  let entry;

  try {
    await client.query("BEGIN");

    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const existing = await client.query(
      `
        SELECT *
        FROM tracking_entries
        WHERE id = $1
          AND child_id = $2
          AND entry_type = 'note'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [entryId, childId],
    );

    if (existing.rowCount === 0) {
      throwNotFound();
    }

    const current = existing.rows[0];

    // Accepter la répétition immédiate d'une modification déjà
    // appliquée, si seule sa réponse a été perdue.
    const isRepeatedUpdate =
      current.version === normalized.version + 1 &&
      current.updated_by_user_id === userId.toLowerCase() &&
      hasSameContent(current, normalized);

    if (isRepeatedUpdate) {
      entry = mapEntry(current);
    } else {
      if (current.version !== normalized.version) {
        throwVersionConflict();
      }

      const updated = await client.query(
        `
          UPDATE tracking_entries
          SET
            note_text = $3,
            started_at = $4,
            updated_by_user_id = $5,
            updated_at = clock_timestamp(),
            version = version + 1
          WHERE id = $1
            AND child_id = $2
            AND entry_type = 'note'
            AND deleted_at IS NULL
            AND version = $6
          RETURNING *
        `,
        [
          entryId,
          childId,
          normalized.note,
          normalized.notedAt,
          userId,
          normalized.version,
        ],
      );

      if (updated.rowCount === 0) {
        throwVersionConflict();
      }

      entry = mapEntry(updated.rows[0]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }

  return entry;
}

module.exports = {
  getNoteEntry,
  createNoteEntry,
  updateNoteEntry,
};
