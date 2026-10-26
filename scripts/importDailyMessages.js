require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

const pool = require("../db/pool");

const LANGUAGES = ["en", "fr", "de", "es", "it", "nl", "pt"];

const CATEGORIES = new Set([
  "nightSleep",
  "daytimeNap",
  "breastfeeding",
  "bottleFeeding",
  "solidFood",
  "growth",
  "motorDevelopment",
  "learning",
  "communication",
  "playtime",
  "teething",
  "healthAndComfort",
  "babyCare",
  "parentSupport",
]);

const SECTION_TYPES = new Set([
  "paragraph",
  "bulletList",
  "numberedList",
  "highlight",
]);

const DATA_DIRECTORY = path.join(__dirname, "../data/dailyMessages");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateMessage(message, language) {
  assert(
    message && typeof message === "object" && !Array.isArray(message),
    `Invalid message in ${language}`,
  );

  const id = message.id;

  assert(
    typeof id === "string" && /^[a-z0-9-]+$/.test(id),
    `Invalid message ID: ${id}`,
  );

  assert(CATEGORIES.has(message.category), `${id}: invalid category`);

  assert(
    message.illustration === message.category,
    `${id}: illustration must match category`,
  );

  assert(
    Number.isInteger(message.minAgeDays) &&
      Number.isInteger(message.maxAgeDays) &&
      message.minAgeDays >= 0 &&
      message.maxAgeDays >= message.minAgeDays &&
      message.maxAgeDays <= 548,
    `${id}: invalid age range`,
  );

  assert(
    Number.isInteger(message.priority) && message.priority >= 0,
    `${id}: invalid priority`,
  );

  assert(
    Array.isArray(message.tags) &&
      message.tags.every((tag) => typeof tag === "string"),
    `${id}: invalid tags`,
  );

  for (const field of ["title", "summary"]) {
    assert(
      typeof message[field] === "string" && message[field].trim().length > 0,
      `${id}: missing ${field} in ${language}`,
    );
  }

  assert(
    Array.isArray(message.sections) && message.sections.length > 0,
    `${id}: missing sections`,
  );

  const sectionIds = new Set();

  for (const section of message.sections) {
    assert(
      typeof section.id === "string" && section.id.length > 0,
      `${id}: invalid section ID`,
    );

    assert(!sectionIds.has(section.id), `${id}: duplicate section ID`);

    sectionIds.add(section.id);

    assert(
      SECTION_TYPES.has(section.type),
      `${id}: invalid section type ${section.type}`,
    );

    if (section.type === "bulletList" || section.type === "numberedList") {
      assert(
        Array.isArray(section.items) &&
          section.items.length > 0 &&
          section.items.every(
            (item) => typeof item === "string" && item.trim(),
          ),
        `${id}: invalid list items`,
      );
    } else {
      assert(
        typeof section.content === "string" &&
          section.content.trim().length > 0,
        `${id}: missing section content`,
      );
    }
  }

  assert(
    Array.isArray(message.sources) &&
      message.sources.every(
        (source) =>
          typeof source.title === "string" &&
          typeof source.url === "string" &&
          /^https:\/\//.test(source.url),
      ),
    `${id}: invalid sources`,
  );

  assert(
    message.askNeloPrompt == null || typeof message.askNeloPrompt === "string",
    `${id}: invalid Ask Nelo prompt`,
  );
}

async function loadMessages() {
  const collections = new Map();

  for (const language of LANGUAGES) {
    const filename = path.join(DATA_DIRECTORY, `messages.${language}.json`);

    let content;

    try {
      content = await fs.readFile(filename, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" && language !== "en") {
        console.log(`[DailyMessages] ${language}: not available yet`);
        continue;
      }

      throw error;
    }

    const messages = JSON.parse(content);

    assert(Array.isArray(messages), `${language}: expected an array`);

    const ids = new Set();

    for (const message of messages) {
      validateMessage(message, language);

      assert(!ids.has(message.id), `${language}: duplicate ID ${message.id}`);

      ids.add(message.id);
    }

    collections.set(language, messages);

    console.log(`[DailyMessages] ${language}: ${messages.length} validated`);
  }

  assert(collections.has("en"), "English catalog is required.");

  const english = new Map(
    collections.get("en").map((message) => [message.id, message]),
  );

  for (const [language, messages] of collections) {
    if (language === "en") continue;

    for (const message of messages) {
      const original = english.get(message.id);

      assert(original, `${language}: unknown message ${message.id}`);

      for (const field of [
        "category",
        "illustration",
        "minAgeDays",
        "maxAgeDays",
        "priority",
      ]) {
        assert(
          message[field] === original[field],
          `${language}/${message.id}: inconsistent ${field}`,
        );
      }

      assert(
        JSON.stringify(message.tags) === JSON.stringify(original.tags),
        `${language}/${message.id}: inconsistent tags`,
      );

      assert(
        JSON.stringify(
          message.sections.map((section) => [section.id, section.type]),
        ) ===
          JSON.stringify(
            original.sections.map((section) => [section.id, section.type]),
          ),
        `${language}/${message.id}: inconsistent sections`,
      );
    }
  }

  return collections;
}

async function importMessages(collections) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const englishMessages = collections.get("en");

    for (const message of englishMessages) {
      await client.query(
        `
        INSERT INTO daily_messages (
          id,
          category,
          illustration,
          min_age_days,
          max_age_days,
          tags,
          priority,
          is_active
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, FALSE
        )
        ON CONFLICT (id)
        DO UPDATE SET
          category = EXCLUDED.category,
          illustration = EXCLUDED.illustration,
          min_age_days = EXCLUDED.min_age_days,
          max_age_days = EXCLUDED.max_age_days,
          tags = EXCLUDED.tags,
          priority = EXCLUDED.priority,
          updated_at = NOW()
        `,
        [
          message.id,
          message.category,
          message.illustration,
          message.minAgeDays,
          message.maxAgeDays,
          JSON.stringify(message.tags),
          message.priority,
        ],
      );
    }

    let translationCount = 0;

    for (const [language, messages] of collections) {
      for (const message of messages) {
        await client.query(
          `
          INSERT INTO daily_message_translations (
            message_id,
            language_code,
            title,
            summary,
            sections,
            sources,
            ask_nelo_prompt
          )
          VALUES (
            $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
          )
          ON CONFLICT (message_id, language_code)
          DO UPDATE SET
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            sections = EXCLUDED.sections,
            sources = EXCLUDED.sources,
            ask_nelo_prompt = EXCLUDED.ask_nelo_prompt
          `,
          [
            message.id,
            language,
            message.title,
            message.summary,
            JSON.stringify(message.sections),
            JSON.stringify(message.sources),
            message.askNeloPrompt ?? null,
          ],
        );

        translationCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`[DailyMessages] Imported ${englishMessages.length} messages`);

    console.log(`[DailyMessages] Imported ${translationCount} translations`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    const collections = await loadMessages();

    if (process.argv.includes("--validate-only")) {
      console.log("[DailyMessages] Validation successful.");
      return;
    }

    await importMessages(collections);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[DailyMessages] Import failed:", error);
  process.exitCode = 1;
});
