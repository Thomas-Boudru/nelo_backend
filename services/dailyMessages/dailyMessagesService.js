const pool = require("../../db/pool");

const SUPPORTED_LANGUAGES = new Set(["en", "fr", "de", "es", "it", "nl", "pt"]);

function serviceError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeLanguage(language) {
  const value = String(language || "en")
    .split(",")[0]
    .split("-")[0]
    .toLowerCase()
    .trim();

  return SUPPORTED_LANGUAGES.has(value) ? value : "en";
}

async function getChild(client, childId, userId, lock = false) {
  const result = await client.query(
    `
    SELECT
      c.id,
      c.birth_status,
      c.birth_date::text AS birth_date,
      c.sleep_timezone
    FROM children c
    JOIN families f
      ON f.id = c.family_id
      AND f.deleted_at IS NULL
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
    WHERE c.id = $1
      AND fm.user_id = $2
      AND c.deleted_at IS NULL
    LIMIT 1
    ${lock ? "FOR UPDATE OF c" : ""}
    `,
    [childId, userId],
  );

  if (!result.rowCount) {
    throw serviceError("CHILD_NOT_FOUND", "The child could not be found.", 404);
  }

  return result.rows[0];
}

function mapMessage(row) {
  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    illustration: row.illustration,
    minAgeDays: row.min_age_days,
    maxAgeDays: row.max_age_days,
    tags: row.tags || [],
    title: row.title,
    summary: row.summary,
    sections: row.sections || [],
    sources: row.sources || [],
    askNeloPrompt: row.ask_nelo_prompt || null,
    language: row.language_code,
  };
}

const MESSAGE_SELECT = `
  SELECT
    m.id,
    m.category,
    m.illustration,
    m.min_age_days,
    m.max_age_days,
    m.tags,
    t.language_code,
    t.title,
    t.summary,
    t.sections,
    t.sources,
    t.ask_nelo_prompt
  FROM daily_messages m
  JOIN LATERAL (
    SELECT tr.*
    FROM daily_message_translations tr
    WHERE tr.message_id = m.id
      AND tr.language_code IN ($2, 'en')
    ORDER BY
      CASE WHEN tr.language_code = $2 THEN 0 ELSE 1 END
    LIMIT 1
  ) t ON TRUE
`;

async function getMessage(client, messageId, language) {
  const result = await client.query(
    `
    ${MESSAGE_SELECT}
    WHERE m.id = $1
    `,
    [messageId, language],
  );

  return mapMessage(result.rows[0]);
}

async function getToday({ childId, userId, language }) {
  const lang = normalizeLanguage(language);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const child = await getChild(client, childId, userId, true);

    if (child.birth_status !== "born" || !child.birth_date) {
      await client.query("COMMIT");
      return { message: null, reason: "CHILD_NOT_BORN" };
    }

    // Date civile du jour dans le fuseau de l'enfant.
    const timezone = child.sleep_timezone || "UTC";

    const dateResult = await client.query(
      `
      SELECT
        (NOW() AT TIME ZONE $1)::date::text AS today,
        GREATEST(
          0,
          (NOW() AT TIME ZONE $1)::date - $2::date
        )::integer AS age_days
      `,
      [timezone, child.birth_date],
    );

    const { today, age_days: ageDays } = dateResult.rows[0];

    if (ageDays > 548) {
      await client.query("COMMIT");
      return { message: null, reason: "AGE_OUT_OF_RANGE" };
    }

    // Le verrou de l'enfant sérialise les attributions.
    const existing = await client.query(
      `
      SELECT message_id
      FROM child_daily_messages
      WHERE child_id = $1 AND message_date = $2
      `,
      [childId, today],
    );

    let messageId = existing.rows[0]?.message_id;

    if (!messageId) {
      const candidates = await client.query(
        `
        SELECT
          m.id,
          m.category,
          m.priority,
          (
            SELECT MAX(h.message_date)
            FROM child_daily_messages h
            WHERE h.child_id = $1
              AND h.message_id = m.id
          ) AS last_seen,
          (
            SELECT COUNT(*)
            FROM child_daily_messages h
            WHERE h.child_id = $1
              AND h.message_id = m.id
          )::integer AS times_seen,
          (
            SELECT MAX(h.message_date)
            FROM child_daily_messages h
            JOIN daily_messages previous
              ON previous.id = h.message_id
            WHERE h.child_id = $1
              AND previous.category = m.category
          ) AS category_last_seen
        FROM daily_messages m
        WHERE m.is_active = TRUE
          AND m.min_age_days <= $2
          AND m.max_age_days >= $2
          AND EXISTS (
            SELECT 1
            FROM daily_message_translations t
            WHERE t.message_id = m.id
              AND t.language_code IN ($3, 'en')
          )
        ORDER BY
          times_seen ASC,
          last_seen ASC NULLS FIRST,
          category_last_seen ASC NULLS FIRST,
          m.priority DESC,
          m.id ASC
        LIMIT 1
        `,
        [childId, ageDays, lang],
      );

      if (!candidates.rowCount) {
        await client.query("COMMIT");
        return { message: null, reason: "NO_ELIGIBLE_MESSAGE" };
      }

      messageId = candidates.rows[0].id;

      await client.query(
        `
        INSERT INTO child_daily_messages (
          child_id, message_id, message_date
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (child_id, message_date)
        DO NOTHING
        `,
        [childId, messageId, today],
      );
    }

    const message = await getMessage(client, messageId, lang);

    await client.query("COMMIT");

    return {
      date: today,
      message,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getHistory({
  childId,
  userId,
  language,
  limit = 30,
  offset = 0,
}) {
  const lang = normalizeLanguage(language);

  await getChild(pool, childId, userId);

  const result = await pool.query(
    `
    SELECT
      h.message_date::text AS date,
      m.id,
      m.category,
      m.illustration,
      t.title,
      t.summary,
      t.language_code
    FROM child_daily_messages h
    JOIN daily_messages m ON m.id = h.message_id
    JOIN LATERAL (
      SELECT tr.title, tr.summary, tr.language_code
      FROM daily_message_translations tr
      WHERE tr.message_id = m.id
        AND tr.language_code IN ($2, 'en')
      ORDER BY
        CASE WHEN tr.language_code = $2 THEN 0 ELSE 1 END
      LIMIT 1
    ) t ON TRUE
    WHERE h.child_id = $1
    ORDER BY h.message_date DESC
    LIMIT $3 OFFSET $4
    `,
    [childId, lang, limit, offset],
  );

  return result.rows.map((row) => ({
    date: row.date,
    message: {
      id: row.id,
      category: row.category,
      illustration: row.illustration,
      title: row.title,
      summary: row.summary,
      language: row.language_code,
    },
  }));
}

async function getById({ childId, userId, messageId, language }) {
  await getChild(pool, childId, userId);

  // Seuls les messages déjà attribués sont accessibles ici.
  const assigned = await pool.query(
    `
    SELECT 1
    FROM child_daily_messages
    WHERE child_id = $1 AND message_id = $2
    LIMIT 1
    `,
    [childId, messageId],
  );

  if (!assigned.rowCount) {
    throw serviceError(
      "DAILY_MESSAGE_NOT_FOUND",
      "The daily message could not be found.",
      404,
    );
  }

  const message = await getMessage(
    pool,
    messageId,
    normalizeLanguage(language),
  );

  if (!message) {
    throw serviceError(
      "DAILY_MESSAGE_NOT_FOUND",
      "The daily message could not be found.",
      404,
    );
  }

  return message;
}

async function getCatalog({ childId, userId, language }) {
  await getChild(pool, childId, userId);

  const lang = normalizeLanguage(language);

  const result = await pool.query(
    `
    ${MESSAGE_SELECT}
    WHERE m.is_active = TRUE
    ORDER BY m.id ASC
    `,
    [null, lang],
  );

  return result.rows.map(mapMessage);
}

module.exports = {
  getToday,
  getHistory,
  getById,
  getCatalog,
};
