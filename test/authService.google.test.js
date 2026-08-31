const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.GOOGLE_WEB_CLIENT_ID = "123-test.apps.googleusercontent.com";
process.env.ACCESS_TOKEN_SECRET = "test-access-token-secret";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-token-secret";
process.env.LOGIN_CODE_SECRET = "test-login-code-secret";

let googlePayload;

const { OAuth2Client } = require("google-auth-library");

OAuth2Client.prototype.verifyIdToken = async () => ({
  getPayload: () => googlePayload,
});

const pool = require("../db/pool");
const authService = require("../services/auth/authService");

const existingUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "parent@example.com",
  display_name: "Parent",
  locale: "en",
  timezone: "UTC",
  status: "active",
  onboarding_completed_at: null,
};

function createClient(queryHandler) {
  return {
    async query(sql, parameters = []) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      if (normalizedSql === "BEGIN" || normalizedSql === "COMMIT") {
        return { rowCount: 0, rows: [] };
      }

      if (normalizedSql === "ROLLBACK") {
        throw new Error("The tested flow unexpectedly rolled back.");
      }

      return queryHandler(normalizedSql, parameters);
    },
    release() {},
  };
}

function result(rows = []) {
  return {
    rowCount: rows.length,
    rows,
  };
}

test("automatically links a verified Gmail identity", async () => {
  googlePayload = {
    sub: "google-gmail-subject",
    email: "parent@gmail.com",
    email_verified: true,
  };

  const user = { ...existingUser, email: googlePayload.email };
  let googleIdentityInserted = false;

  pool.connect = async () =>
    createClient((sql) => {
      if (
        sql.includes("FROM user_identities ui") &&
        sql.includes("ui.provider = 'google'")
      ) {
        return result();
      }

      if (sql.includes("FROM users") && sql.includes("LOWER(email)")) {
        return result([user]);
      }

      if (sql.startsWith("SELECT provider_subject")) {
        return result();
      }

      if (sql.startsWith("SELECT user_id")) {
        return result();
      }

      if (sql.startsWith("UPDATE users")) {
        return result();
      }

      if (sql.startsWith("INSERT INTO user_identities")) {
        googleIdentityInserted = true;
        return result();
      }

      if (sql.startsWith("INSERT INTO user_sessions")) {
        return result([{ id: "session-gmail" }]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

  const response = await authService.signInWithGoogle({
    idToken: "valid-google-token",
    platform: "android",
  });

  assert.equal(googleIdentityInserted, true);
  assert.equal(response.user.id, user.id);
  assert.ok(response.accessToken);
  assert.ok(response.refreshToken);
});

test("requires an email code before linking an external Google email", async () => {
  googlePayload = {
    sub: "google-external-subject",
    email: "parent@orange.fr",
    email_verified: true,
  };

  const user = { ...existingUser, email: googlePayload.email };
  let writeAfterLookup = false;

  pool.connect = async () =>
    createClient((sql) => {
      if (
        sql.includes("FROM user_identities ui") &&
        sql.includes("ui.provider = 'google'")
      ) {
        return result();
      }

      if (sql.includes("FROM users") && sql.includes("LOWER(email)")) {
        return result([user]);
      }

      if (sql.startsWith("SELECT provider_subject")) {
        return result();
      }

      writeAfterLookup = true;
      throw new Error(`Unexpected query: ${sql}`);
    });

  const response = await authService.signInWithGoogle({
    idToken: "valid-google-token",
  });

  assert.deepEqual(response, {
    verificationRequired: true,
    email: googlePayload.email,
  });
  assert.equal(writeAfterLookup, false);
});

test("links an external Google identity after the email code is verified", async () => {
  googlePayload = {
    sub: "google-external-subject",
    email: "parent@orange.fr",
    email_verified: true,
  };

  const code = "123456";
  const codeHash = crypto
    .createHmac("sha256", process.env.LOGIN_CODE_SECRET)
    .update(`${googlePayload.email}:login:${code}`)
    .digest("hex");

  const user = { ...existingUser, email: googlePayload.email };
  let googleIdentityInserted = false;

  pool.connect = async () =>
    createClient((sql) => {
      if (sql.includes("FROM login_codes")) {
        return result([
          {
            id: "login-code-id",
            code_hash: codeHash,
            attempts_count: 0,
            expires_at: new Date(Date.now() + 60_000),
          },
        ]);
      }

      if (sql.startsWith("UPDATE login_codes")) {
        return result();
      }

      if (
        sql.includes("FROM user_identities ui") &&
        sql.includes("ui.provider = 'email'")
      ) {
        return result([user]);
      }

      if (sql.startsWith("UPDATE users") && sql.includes("RETURNING")) {
        return result([user]);
      }

      if (sql.startsWith("UPDATE user_identities")) {
        return result();
      }

      if (sql.startsWith("SELECT user_id")) {
        return result();
      }

      if (sql.startsWith("SELECT provider_subject")) {
        return result();
      }

      if (sql.startsWith("INSERT INTO user_identities")) {
        googleIdentityInserted = true;
        return result();
      }

      if (sql.startsWith("INSERT INTO user_sessions")) {
        return result([{ id: "session-external" }]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

  const response = await authService.verifyLoginCode({
    email: googlePayload.email,
    code,
    googleIdToken: "valid-google-token",
  });

  assert.equal(googleIdentityInserted, true);
  assert.equal(response.user.id, user.id);
  assert.ok(response.accessToken);
});
