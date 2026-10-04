const pool = require("../../db/pool");

const {
  createTrackingError,
  validateUuid,
  requireChildTrackingAccess,
} = require("../tracking/trackingAccess");

const { createSignedDownloadUrl } = require("../storage/r2StorageService");

const MOMENT_TYPES = new Set(["photo", "note", "milestone"]);

// Codes techniques stables.
// Les libellés du catalogue seront traduits dans le frontend.
const MILESTONE_CATALOG = {
  "first-smile": "First smile",
  "first-laugh": "First laugh",
  "rolls-over": "Rolls over",
  "sits-up": "Sits up",
  "starts-crawling": "Starts crawling",
  "first-steps": "First steps",
  "first-word": "First word",

  "first-bottle": "First bottle",
  "first-puree": "First puree",
  "first-solid-food": "First solid food",
  "eats-alone": "Eats independently",

  "first-full-night": "First full night",
  "first-nap-alone": "First nap alone",
  "sleeps-own-room": "Sleeps in their own room",

  "first-tooth": "First tooth",
  "first-haircut": "First haircut",
  "first-vaccine": "First vaccine",
  "first-birthday": "First birthday",

  "first-bath": "First bath",
  "first-outing": "First outing",
  "first-trip": "First trip",
  "first-day-daycare": "First day at daycare",
  "meets-grandparents": "Met the grandparents",
};

const MOMENT_SELECT = `
  SELECT
    m.*,
    TO_CHAR(m.occurred_on, 'YYYY-MM-DD') AS occurred_on_string,
    d.catalog_milestone_code,
    d.custom_milestone_id,
    d.milestone_name_snapshot
  FROM moments m
  LEFT JOIN milestone_details d ON d.moment_id = m.id
`;

function fail(code, message, status = 400) {
  throw createTrackingError(code, message, status);
}

function validateVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("INVALID_MOMENT_VERSION", "Invalid moment version.");
  }

  return value;
}

function validateDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    fail("INVALID_MOMENT_DATE", "Invalid moment date.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    fail("INVALID_MOMENT_DATE", "Invalid moment date.");
  }

  return value;
}

function validateTimezone(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    fail("INVALID_MOMENT_TIMEZONE", "Invalid moment timezone.");
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    fail("INVALID_MOMENT_TIMEZONE", "Invalid moment timezone.");
  }

  return value;
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("INVALID_MOMENT", "Invalid moment.");
  }

  if (!MOMENT_TYPES.has(data.type)) {
    fail("INVALID_MOMENT_TYPE", "Invalid moment type.");
  }

  if (
    data.title != null &&
    (typeof data.title !== "string" || data.title.length > 150)
  ) {
    fail("INVALID_MOMENT_TITLE", "The title must not exceed 150 characters.");
  }

  if (
    data.story != null &&
    (typeof data.story !== "string" || data.story.length > 600)
  ) {
    fail("INVALID_MOMENT_STORY", "The story must not exceed 600 characters.");
  }

  const title = data.title?.trim() || null;

  // Préserver le texte original et ses retours à la ligne.
  const story = data.story ?? null;

  if (data.type === "note" && !story?.trim()) {
    fail("MISSING_MOMENT_STORY", "Please write something about this moment.");
  }

  let milestone = null;

  if (data.type === "milestone") {
    const selection = data.milestone;

    if (
      !selection ||
      typeof selection !== "object" ||
      Array.isArray(selection)
    ) {
      fail("MISSING_MILESTONE", "Please select a milestone.");
    }

    const catalogCode = selection.catalogCode ?? null;
    const customMilestoneId = selection.customMilestoneId ?? null;

    if ((catalogCode !== null) === (customMilestoneId !== null)) {
      fail(
        "INVALID_MILESTONE_SELECTION",
        "Select one catalog or custom milestone.",
      );
    }

    if (catalogCode !== null) {
      if (
        typeof catalogCode !== "string" ||
        !Object.prototype.hasOwnProperty.call(MILESTONE_CATALOG, catalogCode)
      ) {
        fail("INVALID_MILESTONE_CODE", "Invalid milestone code.");
      }
    }

    if (customMilestoneId !== null) {
      validateUuid(customMilestoneId, "custom milestone ID");
    }

    milestone = {
      catalogCode,
      customMilestoneId: customMilestoneId?.toLowerCase() ?? null,
    };
  } else if (data.milestone != null) {
    fail(
      "INVALID_MILESTONE_SELECTION",
      "Only milestone moments can reference a milestone.",
    );
  }

  return {
    type: data.type,
    title,
    story,
    occurredOn: validateDate(data.occurredOn),
    timezoneAtEvent: validateTimezone(data.timezoneAtEvent),
    milestone,
  };
}

function mapMoment(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: row.moment_type,
    title: row.title,
    story: row.story,
    occurredOn: row.occurred_on_string,
    timezoneAtEvent: row.timezone_at_event,
    status: row.status,

    milestone:
      row.moment_type === "milestone"
        ? {
            catalogCode: row.catalog_milestone_code,
            customMilestoneId: row.custom_milestone_id,
            nameSnapshot: row.milestone_name_snapshot,
          }
        : null,

    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedByUserId: row.deleted_by_user_id,

    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),

    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,

    version: row.version,
  };
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Unable to roll back the moment transaction:", {
        message: rollbackError.message,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function readMoment(
  client,
  { childId, momentId, lock = false, includeDeleted = false },
) {
  const result = await client.query(
    `
      ${MOMENT_SELECT}
      WHERE m.id = $1
        AND m.child_id = $2
        ${includeDeleted ? "" : "AND m.deleted_at IS NULL"}
      ${lock ? "FOR UPDATE OF m" : ""}
    `,
    [momentId, childId],
  );

  return result.rows[0] ?? null;
}

function requireMoment(row) {
  if (!row) {
    fail("MOMENT_NOT_FOUND", "Moment not found.", 404);
  }

  return row;
}

function throwVersionConflict() {
  fail(
    "MOMENT_VERSION_CONFLICT",
    "This moment has been modified. Reload it before trying again.",
    409,
  );
}

function hasSameContent(row, data) {
  return (
    row.moment_type === data.type &&
    row.title === data.title &&
    row.story === data.story &&
    row.occurred_on_string === data.occurredOn &&
    row.timezone_at_event === data.timezoneAtEvent &&
    (row.catalog_milestone_code ?? null) ===
      (data.milestone?.catalogCode ?? null) &&
    (row.custom_milestone_id ?? null) ===
      (data.milestone?.customMilestoneId ?? null)
  );
}

async function resolveMilestone(
  client,
  { childId, selection, current = null },
) {
  if (!selection) {
    return null;
  }

  // Conserver le snapshot historique lorsque la sélection
  // ne change pas, même si l'étape a été renommée ou archivée.
  if (
    current &&
    current.catalog_milestone_code === selection.catalogCode &&
    current.custom_milestone_id === selection.customMilestoneId
  ) {
    return {
      ...selection,
      nameSnapshot: current.milestone_name_snapshot,
    };
  }

  if (selection.catalogCode) {
    return {
      ...selection,
      nameSnapshot: MILESTONE_CATALOG[selection.catalogCode],
    };
  }

  const result = await client.query(
    `
      SELECT id, name
      FROM child_custom_milestones
      WHERE id = $1
        AND child_id = $2
        AND archived_at IS NULL
      FOR SHARE
    `,
    [selection.customMilestoneId, childId],
  );

  if (result.rowCount === 0) {
    fail(
      "CUSTOM_MILESTONE_UNAVAILABLE",
      "This custom milestone is unavailable for this child.",
      409,
    );
  }

  return {
    ...selection,
    nameSnapshot: result.rows[0].name,
  };
}

async function saveMilestoneDetails(client, momentId, milestone) {
  if (!milestone) {
    return;
  }

  await client.query(
    `
      INSERT INTO milestone_details (
        moment_id,
        catalog_milestone_code,
        custom_milestone_id,
        milestone_name_snapshot
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (moment_id) DO UPDATE
      SET
        catalog_milestone_code = EXCLUDED.catalog_milestone_code,
        custom_milestone_id = EXCLUDED.custom_milestone_id,
        milestone_name_snapshot = EXCLUDED.milestone_name_snapshot
    `,
    [
      momentId,
      milestone.catalogCode,
      milestone.customMilestoneId,
      milestone.nameSnapshot,
    ],
  );
}

async function readPhotoRows(client, momentIds) {
  if (momentIds.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        link.moment_id,
        link.display_order,
        a.*
      FROM moment_attachments link
      INNER JOIN attachments a ON a.id = link.attachment_id
      WHERE link.moment_id = ANY($1::uuid[])
        AND a.deleted_at IS NULL
      ORDER BY link.moment_id, link.display_order, a.id
    `,
    [momentIds],
  );

  return result.rows;
}

async function attachPhotos(rows, photoRows) {
  const photosByMoment = new Map();

  // Les lignes ont été lues dans la transaction.
  // La signature des URL ne garde pas la transaction ouverte.
  const mappedPhotos = await Promise.all(
    photoRows.map(async (row) => ({
      momentId: row.moment_id,

      photo: {
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
      },
    })),
  );

  for (const { momentId, photo } of mappedPhotos) {
    if (!photosByMoment.has(momentId)) {
      photosByMoment.set(momentId, []);
    }

    photosByMoment.get(momentId).push(photo);
  }

  return rows.map((row) => ({
    ...mapMoment(row),
    photos: photosByMoment.get(row.id) ?? [],
  }));
}

function parseList(value, field) {
  if (value === undefined) {
    return [];
  }

  if (typeof value !== "string" || value.length === 0 || value.length > 4000) {
    fail("INVALID_MOMENT_FILTER", `Invalid ${field} filter.`);
  }

  const values = [...new Set(value.split(",").map((item) => item.trim()))];

  if (values.some((item) => !item) || values.length > 100) {
    fail("INVALID_MOMENT_FILTER", `Invalid ${field} filter.`);
  }

  return values;
}

function parseLimit(value) {
  if (value === undefined) {
    return 30;
  }

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    Number(value) > 100
  ) {
    fail("INVALID_PAGE_LIMIT", "The page limit must be between 1 and 100.");
  }

  return Number(value);
}

function parseCursor(value) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.length > 500) {
    fail("INVALID_MOMENT_CURSOR", "Invalid moment cursor.");
  }

  let decoded;

  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    fail("INVALID_MOMENT_CURSOR", "Invalid moment cursor.");
  }

  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    fail("INVALID_MOMENT_CURSOR", "Invalid moment cursor.");
  }

  validateDate(decoded.occurredOn);
  validateUuid(decoded.id, "moment cursor ID");

  return decoded;
}

async function listMoments({ childId, userId, filters = {}, cursor, limit }) {
  const types = parseList(filters.types, "moment type");
  const authorIds = parseList(filters.authorIds, "author");

  for (const type of types) {
    if (!MOMENT_TYPES.has(type)) {
      fail("INVALID_MOMENT_TYPE", "Invalid moment type.");
    }
  }

  for (const authorId of authorIds) {
    validateUuid(authorId, "author ID");
  }

  const dateFrom =
    filters.dateFrom === undefined ? null : validateDate(filters.dateFrom);

  const dateTo =
    filters.dateTo === undefined ? null : validateDate(filters.dateTo);

  if (dateFrom && dateTo && dateFrom > dateTo) {
    fail("INVALID_DATE_RANGE", "Invalid date range.");
  }

  const pageLimit = parseLimit(limit);
  const pageCursor = parseCursor(cursor);

  const result = await withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    const selected = await client.query(
      `
        ${MOMENT_SELECT}
        WHERE m.child_id = $1
          AND m.deleted_at IS NULL
          AND m.status = 'published'
          AND (
            cardinality($2::text[]) = 0
            OR m.moment_type = ANY($2::text[])
          )
          AND (
            cardinality($3::uuid[]) = 0
            OR m.created_by_user_id = ANY($3::uuid[])
          )
          AND ($4::date IS NULL OR m.occurred_on >= $4::date)
          AND ($5::date IS NULL OR m.occurred_on <= $5::date)
          AND (
            $6::date IS NULL
            OR (m.occurred_on, m.id) < ($6::date, $7::uuid)
          )
        ORDER BY m.occurred_on DESC, m.id DESC
        LIMIT $8
        FOR SHARE OF m
      `,
      [
        childId,
        types,
        authorIds,
        dateFrom,
        dateTo,
        pageCursor?.occurredOn ?? null,
        pageCursor?.id ?? null,
        pageLimit + 1,
      ],
    );

    const hasMore = selected.rows.length > pageLimit;
    const rows = selected.rows.slice(0, pageLimit);

    const photoRows = await readPhotoRows(
      client,
      rows.map((row) => row.id),
    );

    return { rows, photoRows, hasMore };
  });

  const last = result.rows[result.rows.length - 1];

  return {
    moments: await attachPhotos(result.rows, result.photoRows),

    nextCursor:
      result.hasMore && last
        ? Buffer.from(
            JSON.stringify({
              occurredOn: last.occurred_on_string,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}

async function getMoment({ childId, userId, momentId }) {
  validateUuid(momentId, "moment ID");

  const result = await withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      database: client,
    });

    const row = requireMoment(
      await readMoment(client, {
        childId,
        momentId,
        lock: true,
      }),
    );

    const photoRows = await readPhotoRows(client, [row.id]);

    return { row, photoRows };
  });

  const [moment] = await attachPhotos([result.row], result.photoRows);

  return moment;
}

async function createMoment({ childId, userId, data }) {
  const normalized = validateData(data);

  validateUuid(data.id, "moment ID");

  const momentId = data.id.toLowerCase();

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const inserted = await client.query(
      `
        INSERT INTO moments (
          id,
          child_id,
          moment_type,
          title,
          story,
          occurred_on,
          timezone_at_event,
          status,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          'draft', $8, $8
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [
        momentId,
        childId,
        normalized.type,
        normalized.title,
        normalized.story,
        normalized.occurredOn,
        normalized.timezoneAtEvent,
        userId,
      ],
    );

    if (inserted.rowCount === 0) {
      const current = await readMoment(client, {
        childId,
        momentId,
        lock: true,
        includeDeleted: true,
      });

      if (
        !current ||
        current.deleted_at ||
        current.created_by_user_id !== userId.toLowerCase() ||
        !hasSameContent(current, normalized)
      ) {
        fail("MOMENT_ID_CONFLICT", "This moment ID is already used.", 409);
      }

      return {
        created: false,
        moment: mapMoment(current),
      };
    }

    const milestone = await resolveMilestone(client, {
      childId,
      selection: normalized.milestone,
    });

    await saveMilestoneDetails(client, momentId, milestone);

    const row = await readMoment(client, { childId, momentId });

    return {
      created: true,
      moment: mapMoment(row),
    };
  });
}

async function updateMoment({ childId, userId, momentId, data }) {
  validateUuid(momentId, "moment ID");

  const normalized = validateData(data);
  const expectedVersion = validateVersion(data.version);

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const current = requireMoment(
      await readMoment(client, {
        childId,
        momentId,
        lock: true,
      }),
    );

    // Le formulaire édite le contenu d'un souvenir,
    // mais ne convertit pas son type.
    if (current.moment_type !== normalized.type) {
      fail(
        "MOMENT_TYPE_CANNOT_CHANGE",
        "The moment type cannot be changed.",
        409,
      );
    }

    const isRepeatedUpdate =
      current.version === expectedVersion + 1 &&
      current.updated_by_user_id === userId.toLowerCase() &&
      hasSameContent(current, normalized);

    if (isRepeatedUpdate) {
      return mapMoment(current);
    }

    if (current.version !== expectedVersion) {
      throwVersionConflict();
    }

    const milestone = await resolveMilestone(client, {
      childId,
      selection: normalized.milestone,
      current,
    });

    await saveMilestoneDetails(client, momentId, milestone);

    await client.query(
      `
        UPDATE moments
        SET
          title = $3,
          story = $4,
          occurred_on = $5,
          timezone_at_event = $6,
          updated_by_user_id = $7,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1
          AND child_id = $2
      `,
      [
        momentId,
        childId,
        normalized.title,
        normalized.story,
        normalized.occurredOn,
        normalized.timezoneAtEvent,
        userId,
      ],
    );

    return mapMoment(await readMoment(client, { childId, momentId }));
  });
}

async function publishMoment({ childId, userId, momentId, data }) {
  validateUuid(momentId, "moment ID");

  const expectedVersion = validateVersion(data?.version);

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const current = requireMoment(
      await readMoment(client, {
        childId,
        momentId,
        lock: true,
      }),
    );

    if (current.status === "published") {
      const isRepeatedPublish =
        current.version === expectedVersion + 1 &&
        current.updated_by_user_id === userId.toLowerCase();

      if (current.version !== expectedVersion && !isRepeatedPublish) {
        throwVersionConflict();
      }

      return mapMoment(current);
    }

    if (current.version !== expectedVersion) {
      throwVersionConflict();
    }

    const photos = await readPhotoRows(client, [momentId]);

    if (photos.length > 6) {
      fail(
        "MOMENT_PHOTO_LIMIT_REACHED",
        "A moment must not contain more than 6 photos.",
      );
    }

    if (current.moment_type === "photo" && photos.length === 0) {
      fail("MISSING_MOMENT_PHOTO", "Please add at least one photo.");
    }

    if (current.moment_type === "note") {
      if (!current.story?.trim()) {
        fail(
          "MISSING_MOMENT_STORY",
          "Please write something about this moment.",
        );
      }

      if (photos.length > 0) {
        fail(
          "NOTE_MOMENT_PHOTOS_NOT_ALLOWED",
          "Note moments cannot contain photos.",
        );
      }
    }

    if (
      current.moment_type === "milestone" &&
      !current.catalog_milestone_code &&
      !current.custom_milestone_id
    ) {
      fail("MISSING_MILESTONE", "Please select a milestone.");
    }

    await client.query(
      `
        UPDATE moments
        SET
          status = 'published',
          updated_by_user_id = $3,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1
          AND child_id = $2
      `,
      [momentId, childId, userId],
    );

    return mapMoment(await readMoment(client, { childId, momentId }));
  });
}

async function deleteMoment({ childId, userId, momentId, data }) {
  validateUuid(momentId, "moment ID");

  const expectedVersion = validateVersion(data?.version);

  return withTransaction(async (client) => {
    await requireChildTrackingAccess({
      childId,
      userId,
      write: true,
      database: client,
    });

    const current = requireMoment(
      await readMoment(client, {
        childId,
        momentId,
        lock: true,
        includeDeleted: true,
      }),
    );

    if (current.deleted_at) {
      return {
        deleted: true,
        moment: mapMoment(current),
      };
    }

    if (current.version !== expectedVersion) {
      throwVersionConflict();
    }

    await client.query(
      `
        UPDATE moments
        SET
          deleted_at = clock_timestamp(),
          deleted_by_user_id = $3,
          updated_by_user_id = $3,
          updated_at = clock_timestamp(),
          version = version + 1
        WHERE id = $1
          AND child_id = $2
      `,
      [momentId, childId, userId],
    );

    const deleted = await readMoment(client, {
      childId,
      momentId,
      includeDeleted: true,
    });

    return {
      deleted: true,
      moment: mapMoment(deleted),
    };
  });
}

module.exports = {
  listMoments,
  getMoment,
  createMoment,
  updateMoment,
  deleteMoment,
  publishMoment,
};
