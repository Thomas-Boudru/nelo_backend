const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";

const pool = require("../db/pool");
const childrenService = require("../services/children/childrenService");

test("returns only children accessible through the authenticated member", async () => {
  const authenticatedUserId = "11111111-1111-4111-8111-111111111111";
  let receivedParameters;
  let receivedSql;

  pool.query = async (sql, parameters) => {
    receivedSql = sql.replace(/\s+/g, " ").trim();
    receivedParameters = parameters;

    return {
      rowCount: 1,
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          display_name: "Emma",
          birth_status: "born",
          birth_date: "2025-04-12",
          expected_due_date: null,
          sex_at_birth: "female",
          family_id: "33333333-3333-4333-8333-333333333333",
          updated_at: "2026-08-30T10:00:00.000Z",
          child_role: "owner",
          theme_mode: "pink",
          avatar_storage_key: "https://cdn.example.com/emma.jpg",
        },
      ],
    };
  };

  const children =
    await childrenService.getAccessibleChildren(authenticatedUserId);

  assert.deepEqual(receivedParameters, [authenticatedUserId]);
  assert.match(receivedSql, /FROM family_members fm/);
  assert.match(receivedSql, /INNER JOIN children_members cm/);
  assert.match(receivedSql, /fm\.removed_at IS NULL/);
  assert.match(receivedSql, /cm\.revoked_at IS NULL/);
  assert.deepEqual(children, [
    {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Emma",
      birthStatus: "born",
      birthDate: "2025-04-12",
      expectedBirthDate: null,
      gender: "female",
      avatarUrl: "https://cdn.example.com/emma.jpg",
      themeMode: "pink",
      familyId: "33333333-3333-4333-8333-333333333333",
      role: "owner",
      updatedAt: "2026-08-30T10:00:00.000Z",
    },
  ]);
});
