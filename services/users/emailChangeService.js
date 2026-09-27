const crypto = require("crypto");

const pool = require("../../db/pool");
const { sendEmailChangeCodeEmail } = require("../email/emailService");
const userService = require("./userService");

const CODE_EXPIRATION_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    throw serviceError("INVALID_EMAIL", "Enter a valid email address.", 400);
  }

  const normalized = email.trim().toLowerCase();

  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw serviceError("INVALID_EMAIL", "Enter a valid email address.", 400);
  }

  return normalized;
}

function hashCode(userId, email, code) {
  if (!process.env.LOGIN_CODE_SECRET) {
    throw new Error("Missing LOGIN_CODE_SECRET environment variable.");
  }

  return crypto
    .createHmac("sha256", process.env.LOGIN_CODE_SECRET)
    .update(`email-change:${userId}:${email}:${code}`)
    .digest("hex");
}

function codeMatches(userId, email, code, storedHash) {
  const submitted = Buffer.from(hashCode(userId, email, code), "hex");
  const stored = Buffer.from(storedHash, "hex");

  return (
    submitted.length === stored.length &&
    crypto.timingSafeEqual(submitted, stored)
  );
}

async function assertEmailAvailable(client, email, userId) {
  const result = await client.query(
    `
      SELECT 1
      FROM users
      WHERE LOWER(email) = $1
        AND id <> $2
        AND deleted_at IS NULL

      UNION ALL

      SELECT 1
      FROM user_identities
      WHERE provider = 'email'
        AND provider_subject = $1
        AND user_id <> $2

      LIMIT 1
    `,
    [email, userId],
  );

  if (result.rowCount > 0) {
    throw serviceError(
      "EMAIL_ALREADY_IN_USE",
      "This email address is already associated with an account.",
      409,
    );
  }
}

async function requestEmailChange({ userId, email, locale = "en" }) {
  const newEmail = normalizeEmail(email);
  const client = await pool.connect();

  let requestId;
  let code;

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT email
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw serviceError("USER_NOT_FOUND", "Account not found.", 404);
    }

    if (userResult.rows[0].email.toLowerCase() === newEmail) {
      throw serviceError(
        "EMAIL_UNCHANGED",
        "This is already your email address.",
        400,
      );
    }

    await assertEmailAvailable(client, newEmail, userId);

    const recentResult = await client.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE created_at > NOW() - INTERVAL '1 minute'
          )::integer AS last_minute,
          COUNT(*)::integer AS last_hour
        FROM email_change_requests
        WHERE user_id = $1
          AND created_at > NOW() - INTERVAL '1 hour'
      `,
      [userId],
    );

    const recent = recentResult.rows[0];

    if (recent.last_minute >= 1 || recent.last_hour >= 5) {
      throw serviceError(
        "EMAIL_CHANGE_RATE_LIMITED",
        "Please wait before requesting another code.",
        429,
      );
    }

    await client.query(
      `
        UPDATE email_change_requests
        SET consumed_at = NOW()
        WHERE user_id = $1
          AND consumed_at IS NULL
      `,
      [userId],
    );

    code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");

    const result = await client.query(
      `
        INSERT INTO email_change_requests (
          user_id,
          new_email,
          code_hash,
          expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          NOW() + ($4 * INTERVAL '1 minute')
        )
        RETURNING id
      `,
      [
        userId,
        newEmail,
        hashCode(userId, newEmail, code),
        CODE_EXPIRATION_MINUTES,
      ],
    );

    requestId = result.rows[0].id;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendEmailChangeCodeEmail({
      email: newEmail,
      code,
      locale,
    });
  } catch (error) {
    console.error("Unable to send email change code:", error);

    await pool.query(
      `
        UPDATE email_change_requests
        SET consumed_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL
      `,
      [requestId],
    );

    throw serviceError(
      "EMAIL_DELIVERY_FAILED",
      "Unable to send the verification code. Please try again.",
      503,
    );
  }

  return {
    message: "A verification code has been sent to your new email address.",
  };
}

async function verifyEmailChange({ userId, email, code }) {
  const newEmail = normalizeEmail(email);

  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    throw serviceError(
      "INVALID_EMAIL_CHANGE_CODE",
      "The verification code is invalid or has expired.",
      400,
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT email
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw serviceError("USER_NOT_FOUND", "Account not found.", 404);
    }

    const requestResult = await client.query(
      `
        SELECT id, code_hash, attempts_count, expires_at
        FROM email_change_requests
        WHERE user_id = $1
          AND new_email = $2
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [userId, newEmail],
    );

    const request = requestResult.rows[0];

    if (!request || new Date(request.expires_at) <= new Date()) {
      throw serviceError(
        "INVALID_EMAIL_CHANGE_CODE",
        "The verification code is invalid or has expired.",
        400,
      );
    }

    if (request.attempts_count >= MAX_CODE_ATTEMPTS) {
      throw serviceError(
        "EMAIL_CHANGE_ATTEMPTS_EXCEEDED",
        "Too many incorrect attempts. Request a new code.",
        429,
      );
    }

    if (!codeMatches(userId, newEmail, code.trim(), request.code_hash)) {
      const attempts = request.attempts_count + 1;

      await client.query(
        `
          UPDATE email_change_requests
          SET attempts_count = attempts_count + 1,
              consumed_at = CASE
                WHEN attempts_count + 1 >= $2 THEN NOW()
                ELSE consumed_at
              END
          WHERE id = $1
        `,
        [request.id, MAX_CODE_ATTEMPTS],
      );

      // Conserver le compteur d'essais même si le code est incorrect.
      await client.query("COMMIT");

      throw serviceError(
        attempts >= MAX_CODE_ATTEMPTS
          ? "EMAIL_CHANGE_ATTEMPTS_EXCEEDED"
          : "INVALID_EMAIL_CHANGE_CODE",
        attempts >= MAX_CODE_ATTEMPTS
          ? "Too many incorrect attempts. Request a new code."
          : "The verification code is invalid or has expired.",
        attempts >= MAX_CODE_ATTEMPTS ? 429 : 400,
      );
    }

    // L'adresse a pu être prise depuis l'envoi du code.
    await assertEmailAvailable(client, newEmail, userId);

    /*
     * Si le compte se connectait déjà par e-mail, on déplace son
     * identité vers la nouvelle adresse. Pour un compte Apple/Google
     * sans identité e-mail, on en crée une après vérification du code.
     */
    await client.query(
      `
    INSERT INTO user_identities (
      user_id,
      provider,
      provider_subject,
      provider_email,
      email_verified_at
    )
    VALUES ($1, 'email', $2::varchar(255), $2::text, NOW())
    ON CONFLICT (user_id, provider)
    DO UPDATE SET
      provider_subject = EXCLUDED.provider_subject,
      provider_email = EXCLUDED.provider_email,
      email_verified_at = NOW()
  `,
      [userId, newEmail],
    );

    await client.query(
      `
        UPDATE users
        SET email = $2,
            email_verified_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [userId, newEmail],
    );

    await client.query(
      `
        UPDATE email_change_requests
        SET consumed_at = NOW()
        WHERE user_id = $1
          AND consumed_at IS NULL
      `,
      [userId],
    );

    await client.query("COMMIT");
  } catch (error) {
    // Une adresse peut être prise par une requête concurrente.
    if (error.code === "23505") {
      throw serviceError(
        "EMAIL_ALREADY_IN_USE",
        "This email address is already associated with an account.",
        409,
      );
    }

    throw error;
  } finally {
    // ROLLBACK est sans effet après un COMMIT.
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }

  return {
    user: await userService.getCurrentUser(userId),
  };
}

module.exports = {
  requestEmailChange,
  verifyEmailChange,
};
