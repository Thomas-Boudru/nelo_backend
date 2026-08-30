const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { OAuth2Client } = require("google-auth-library");

const { sendLoginCodeEmail } = require("../email/emailService");

const pool = require("../../db/pool");

const LOGIN_CODE_EXPIRATION_MINUTES = 10;
const MAX_LOGIN_CODE_ATTEMPTS = 5;
const ACCESS_TOKEN_DURATION = "15m";
const REFRESH_TOKEN_DURATION_DAYS = 30;

const appleJwksClient = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

const googleOauthClient = new OAuth2Client();

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function generateLoginCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function hashLoginCode(email, code) {
  if (!process.env.LOGIN_CODE_SECRET) {
    throw new Error("Missing LOGIN_CODE_SECRET environment variable.");
  }

  return crypto
    .createHmac("sha256", process.env.LOGIN_CODE_SECRET)
    .update(`${email}:login:${code}`)
    .digest("hex");
}

async function requestLoginCode({ email, locale = "en", ipAddress }) {
  const normalizedEmail = normalizeEmail(email);
  const loginCode = generateLoginCode();
  const codeHash = hashLoginCode(normalizedEmail, loginCode);

  const client = await pool.connect();

  let loginCodeId;

  try {
    await client.query("BEGIN");

    // Les anciens codes encore actifs deviennent inutilisables.
    await client.query(
      `
        UPDATE login_codes
        SET consumed_at = NOW()
        WHERE email = $1
          AND purpose = 'login'
          AND consumed_at IS NULL
          AND expires_at > NOW()
      `,
      [normalizedEmail],
    );

    const insertResult = await client.query(
      `
        INSERT INTO login_codes (
          email,
          code_hash,
          purpose,
          attempts_count,
          expires_at,
          requested_ip
        )
        VALUES (
          $1,
          $2,
          'login',
          0,
          NOW() + ($3 * INTERVAL '1 minute'),
          $4
        )
        RETURNING id
      `,
      [
        normalizedEmail,
        codeHash,
        LOGIN_CODE_EXPIRATION_MINUTES,
        ipAddress || null,
      ],
    );

    loginCodeId = insertResult.rows[0].id;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendLoginCodeEmail({
      email: normalizedEmail,
      code: loginCode,
      locale,
    });
  } catch (error) {
    console.error("Unable to send login email:", error);

    /*
     * Si l’email n’a pas pu être envoyé, le code correspondant
     * devient immédiatement inutilisable.
     */
    await pool.query(
      `
        UPDATE login_codes
        SET consumed_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL
      `,
      [loginCodeId],
    );

    const deliveryError = new Error(
      "Unable to send the verification code. Please try again.",
    );

    deliveryError.status = 503;
    deliveryError.code = "EMAIL_DELIVERY_FAILED";

    throw deliveryError;
  }

  return {
    message: "If this email can receive a login code, a code has been sent.",
  };
}

function createAuthError(code, message, status = 401) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function compareLoginCode(email, submittedCode, storedHash) {
  const submittedHash = hashLoginCode(email, submittedCode);

  const submittedBuffer = Buffer.from(submittedHash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (submittedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(submittedBuffer, storedBuffer);
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(refreshToken) {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new Error("Missing REFRESH_TOKEN_SECRET environment variable.");
  }

  return crypto
    .createHmac("sha256", process.env.REFRESH_TOKEN_SECRET)
    .update(refreshToken)
    .digest("hex");
}

function generateAccessToken({ userId, sessionId }) {
  if (!process.env.ACCESS_TOKEN_SECRET) {
    throw new Error("Missing ACCESS_TOKEN_SECRET environment variable.");
  }

  return jwt.sign(
    {
      sub: userId,
      sessionId,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: ACCESS_TOKEN_DURATION,
      issuer: "nelo-api",
      audience: "nelo-app",
    },
  );
}

function getAppleSigningKey(header, callback) {
  if (!header.kid) {
    callback(
      createAuthError(
        "INVALID_APPLE_TOKEN",
        "The Apple identity token is invalid.",
      ),
    );

    return;
  }

  appleJwksClient.getSigningKey(header.kid, (error, key) => {
    if (error) {
      callback(error);
      return;
    }

    callback(null, key.getPublicKey());
  });
}

function verifyAppleJwt(identityToken) {
  if (!process.env.APPLE_CLIENT_ID) {
    throw new Error("Missing APPLE_CLIENT_ID environment variable.");
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      identityToken,
      getAppleSigningKey,
      {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience: process.env.APPLE_CLIENT_ID,
      },
      (error, payload) => {
        if (error) {
          reject(
            createAuthError(
              "INVALID_APPLE_TOKEN",
              "The Apple identity token is invalid or has expired.",
            ),
          );

          return;
        }

        resolve(payload);
      },
    );
  });
}

function verifyAppleNonce(payloadNonce, rawNonce) {
  if (!payloadNonce || !rawNonce) {
    return false;
  }

  const expectedNonce = crypto
    .createHash("sha256")
    .update(rawNonce)
    .digest("hex");

  const receivedBuffer = Buffer.from(payloadNonce);
  const expectedBuffer = Buffer.from(expectedNonce);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function verifyAppleIdentityToken(identityToken, nonce) {
  const payload = await verifyAppleJwt(identityToken);

  if (!verifyAppleNonce(payload.nonce, nonce)) {
    throw createAuthError(
      "INVALID_APPLE_NONCE",
      "The Apple authentication request could not be verified.",
    );
  }

  if (!payload.sub) {
    throw createAuthError(
      "INVALID_APPLE_IDENTITY",
      "The Apple user identifier is missing.",
    );
  }

  return {
    subject: payload.sub,
    email: payload.email ? normalizeEmail(payload.email) : null,

    emailVerified:
      payload.email_verified === true || payload.email_verified === "true",

    isPrivateEmail:
      payload.is_private_email === true || payload.is_private_email === "true",
  };
}

async function verifyGoogleIdentityToken(idToken) {
  if (!process.env.GOOGLE_WEB_CLIENT_ID) {
    throw new Error("Missing GOOGLE_WEB_CLIENT_ID environment variable.");
  }

  let ticket;

  try {
    ticket = await googleOauthClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });
  } catch {
    throw createAuthError(
      "INVALID_GOOGLE_TOKEN",
      "The Google ID token is invalid or has expired.",
    );
  }

  const payload = ticket.getPayload();

  if (!payload?.sub) {
    throw createAuthError(
      "INVALID_GOOGLE_IDENTITY",
      "The Google user identifier is missing.",
    );
  }

  return {
    subject: payload.sub,
    email: payload.email ? normalizeEmail(payload.email) : null,
    emailVerified:
      payload.email_verified === true || payload.email_verified === "true",
    hostedDomain: payload.hd || null,
  };
}

function isGoogleAuthoritativeForEmail(googleIdentity) {
  if (!googleIdentity.email || !googleIdentity.emailVerified) {
    return false;
  }

  return (
    googleIdentity.email.endsWith("@gmail.com") ||
    Boolean(googleIdentity.hostedDomain)
  );
}

async function attachGoogleIdentity(client, userId, googleIdentity) {
  const subjectIdentityResult = await client.query(
    `
      SELECT user_id
      FROM user_identities
      WHERE provider = 'google'
        AND provider_subject = $1
      LIMIT 1
      FOR UPDATE
    `,
    [googleIdentity.subject],
  );

  if (
    subjectIdentityResult.rowCount > 0 &&
    subjectIdentityResult.rows[0].user_id !== userId
  ) {
    throw createAuthError(
      "GOOGLE_IDENTITY_ALREADY_LINKED",
      "This Google account is already linked to another Nelo account.",
      409,
    );
  }

  const userIdentityResult = await client.query(
    `
      SELECT provider_subject
      FROM user_identities
      WHERE user_id = $1
        AND provider = 'google'
      LIMIT 1
      FOR UPDATE
    `,
    [userId],
  );

  if (
    userIdentityResult.rowCount > 0 &&
    userIdentityResult.rows[0].provider_subject !== googleIdentity.subject
  ) {
    throw createAuthError(
      "NELO_ACCOUNT_ALREADY_LINKED_TO_GOOGLE",
      "This Nelo account is already linked to another Google account.",
      409,
    );
  }

  if (subjectIdentityResult.rowCount > 0) {
    await client.query(
      `
        UPDATE user_identities
        SET
          provider_email = $2,
          email_verified_at = COALESCE(email_verified_at, NOW()),
          last_used_at = NOW()
        WHERE provider = 'google'
          AND provider_subject = $1
      `,
      [googleIdentity.subject, googleIdentity.email],
    );

    return;
  }

  await client.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_subject,
        provider_email,
        email_verified_at,
        last_used_at
      )
      VALUES ($1, 'google', $2, $3, NOW(), NOW())
    `,
    [userId, googleIdentity.subject, googleIdentity.email],
  );
}

function getApplePrivateKey() {
  const privateKey = process.env.APPLE_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("Missing APPLE_PRIVATE_KEY environment variable.");
  }

  return privateKey.replace(/\\n/g, "\n").trim();
}

function createAppleClientSecret() {
  if (!process.env.APPLE_TEAM_ID) {
    throw new Error("Missing APPLE_TEAM_ID environment variable.");
  }

  if (!process.env.APPLE_KEY_ID) {
    throw new Error("Missing APPLE_KEY_ID environment variable.");
  }

  if (!process.env.APPLE_CLIENT_ID) {
    throw new Error("Missing APPLE_CLIENT_ID environment variable.");
  }

  return jwt.sign({}, getApplePrivateKey(), {
    algorithm: "ES256",
    keyid: process.env.APPLE_KEY_ID,
    issuer: process.env.APPLE_TEAM_ID,
    audience: "https://appleid.apple.com",
    subject: process.env.APPLE_CLIENT_ID,
    expiresIn: "5m",
  });
}

async function exchangeAppleAuthorizationCode(authorizationCode) {
  const parameters = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    client_secret: createAppleClientSecret(),
    code: authorizationCode,
    grant_type: "authorization_code",
  });

  let response;

  try {
    response = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",

      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },

      body: parameters.toString(),
    });
  } catch (error) {
    console.error("Unable to contact the Apple token endpoint:", error);

    throw createAuthError(
      "APPLE_SERVICE_UNAVAILABLE",
      "Apple authentication is temporarily unavailable.",
      503,
    );
  }

  const result = await response.json();

  if (!response.ok) {
    console.error("Apple token exchange failed:", {
      status: response.status,
      error: result.error,
    });

    throw createAuthError(
      "APPLE_TOKEN_EXCHANGE_FAILED",
      "Apple authentication could not be completed.",
      401,
    );
  }

  if (!result.refresh_token) {
    throw createAuthError(
      "APPLE_REFRESH_TOKEN_MISSING",
      "Apple did not return the required refresh token.",
      401,
    );
  }

  return {
    refreshToken: result.refresh_token,
    accessToken: result.access_token || null,
    identityToken: result.id_token || null,
    expiresIn: result.expires_in || null,
  };
}

function getOauthTokenEncryptionKey() {
  const encodedKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

  if (!encodedKey) {
    throw new Error("Missing OAUTH_TOKEN_ENCRYPTION_KEY environment variable.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes.",
    );
  }

  return key;
}

function encryptOauthToken(token) {
  const initializationVector = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getOauthTokenEncryptionKey(),
    initializationVector,
  );

  const encryptedToken = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const authenticationTag = cipher.getAuthTag();

  return {
    encryptedToken: encryptedToken.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: authenticationTag.toString("base64"),
  };
}

async function verifyLoginCode({
  email,
  code,
  locale = "en",
  deviceName,
  platform,
  appVersion,
  ipAddress,
  userAgent,
  googleIdToken,
}) {
  const normalizedEmail = normalizeEmail(email);
  const googleIdentity = googleIdToken
    ? await verifyGoogleIdentityToken(googleIdToken)
    : null;

  if (
    googleIdentity &&
    (!googleIdentity.emailVerified || googleIdentity.email !== normalizedEmail)
  ) {
    throw createAuthError(
      "GOOGLE_EMAIL_MISMATCH",
      "The verified Google email does not match this verification code.",
      400,
    );
  }

  const client = await pool.connect();

  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const codeResult = await client.query(
      `
        SELECT
          id,
          code_hash,
          attempts_count,
          expires_at
        FROM login_codes
        WHERE email = $1
          AND purpose = 'login'
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedEmail],
    );

    if (codeResult.rowCount === 0) {
      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "INVALID_LOGIN_CODE",
        "The login code is invalid or has expired.",
      );
    }

    const loginCode = codeResult.rows[0];

    if (new Date(loginCode.expires_at) <= new Date()) {
      await client.query(
        `
          UPDATE login_codes
          SET consumed_at = NOW()
          WHERE id = $1
        `,
        [loginCode.id],
      );

      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "INVALID_LOGIN_CODE",
        "The login code is invalid or has expired.",
      );
    }

    if (loginCode.attempts_count >= MAX_LOGIN_CODE_ATTEMPTS) {
      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "LOGIN_CODE_ATTEMPTS_EXCEEDED",
        "Too many incorrect attempts. Request a new login code.",
        429,
      );
    }

    const codeIsValid = compareLoginCode(
      normalizedEmail,
      code,
      loginCode.code_hash,
    );

    if (!codeIsValid) {
      const nextAttemptsCount = loginCode.attempts_count + 1;

      await client.query(
        `
          UPDATE login_codes
          SET
            attempts_count = attempts_count + 1,
            consumed_at = CASE
              WHEN attempts_count + 1 >= $2 THEN NOW()
              ELSE consumed_at
            END
          WHERE id = $1
        `,
        [loginCode.id, MAX_LOGIN_CODE_ATTEMPTS],
      );

      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        nextAttemptsCount >= MAX_LOGIN_CODE_ATTEMPTS
          ? "LOGIN_CODE_ATTEMPTS_EXCEEDED"
          : "INVALID_LOGIN_CODE",
        nextAttemptsCount >= MAX_LOGIN_CODE_ATTEMPTS
          ? "Too many incorrect attempts. Request a new login code."
          : "The login code is invalid or has expired.",
        nextAttemptsCount >= MAX_LOGIN_CODE_ATTEMPTS ? 429 : 401,
      );
    }

    await client.query(
      `
        UPDATE login_codes
        SET consumed_at = NOW()
        WHERE id = $1
      `,
      [loginCode.id],
    );

    const userResult = await client.query(
      `
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.locale,
      u.timezone,
      u.status,
      u.onboarding_completed_at

    FROM user_identities ui

    INNER JOIN users u
      ON u.id = ui.user_id

    WHERE ui.provider = 'email'
      AND ui.provider_subject = $1
      AND u.deleted_at IS NULL

    LIMIT 1

    FOR UPDATE OF u, ui
  `,
      [normalizedEmail],
    );

    let user;

    if (userResult.rowCount > 0) {
      /*
       * L’utilisateur existe déjà : actualiser ses informations
       * et la dernière utilisation de son identité e-mail.
       */
      const updatedUserResult = await client.query(
        `
      UPDATE users

      SET
        locale = $2,
        email_verified_at = COALESCE(email_verified_at, NOW()),
        last_login_at = NOW(),
        updated_at = NOW()

      WHERE id = $1

      RETURNING
        id,
        email,
        display_name,
        locale,
        timezone,
        status,
        onboarding_completed_at
    `,
        [userResult.rows[0].id, locale],
      );

      user = updatedUserResult.rows[0];

      await client.query(
        `
      UPDATE user_identities

      SET
        provider_email = $2,
        email_verified_at = COALESCE(email_verified_at, NOW()),
        last_used_at = NOW()

      WHERE user_id = $1
        AND provider = 'email'
    `,
        [user.id, normalizedEmail],
      );
    } else {
      /*
       * Première connexion : créer l’utilisateur puis son identité
       * e-mail dans la même transaction.
       */
      const createdUserResult = await client.query(
        `
      INSERT INTO users (
        email,
        locale,
        email_verified_at,
        last_login_at
      )
      VALUES ($1, $2, NOW(), NOW())

      ON CONFLICT (email)
      WHERE deleted_at IS NULL

      DO UPDATE SET
        locale = EXCLUDED.locale,
        email_verified_at = COALESCE(
          users.email_verified_at,
          EXCLUDED.email_verified_at
        ),
        last_login_at = NOW(),
        updated_at = NOW()

      RETURNING
        id,
        email,
        display_name,
        locale,
        timezone,
        status,
        onboarding_completed_at
    `,
        [normalizedEmail, locale],
      );

      user = createdUserResult.rows[0];

      await client.query(
        `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_subject,
        provider_email,
        email_verified_at,
        last_used_at
      )
      VALUES (
        $1,
        'email',
        $2,
        $2,
        NOW(),
        NOW()
      )

      ON CONFLICT (provider, provider_subject)

      DO UPDATE SET
        provider_email = EXCLUDED.provider_email,
        email_verified_at = COALESCE(
          user_identities.email_verified_at,
          EXCLUDED.email_verified_at
        ),
        last_used_at = NOW()
    `,
        [user.id, normalizedEmail],
      );
    }

    if (user.status === "suspended") {
      throw createAuthError(
        "ACCOUNT_SUSPENDED",
        "This account has been suspended.",
        403,
      );
    }

    if (googleIdentity) {
      await attachGoogleIdentity(client, user.id, googleIdentity);
    }

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const sessionResult = await client.query(
      `
        INSERT INTO user_sessions (
          user_id,
          refresh_token_hash,
          device_name,
          platform,
          app_version,
          ip_address,
          user_agent,
          expires_at,
          last_used_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW() + ($8 * INTERVAL '1 day'),
          NOW()
        )
        RETURNING id
      `,
      [
        user.id,
        refreshTokenHash,
        deviceName || null,
        platform || "unknown",
        appVersion || null,
        ipAddress || null,
        userAgent || null,
        REFRESH_TOKEN_DURATION_DAYS,
      ],
    );

    const sessionId = sessionResult.rows[0].id;

    const accessToken = generateAccessToken({
      userId: user.id,
      sessionId,
    });

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale,
        timezone: user.timezone,
        onboardingCompletedAt: user.onboarding_completed_at,
      },
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function signInWithApple({
  identityToken,
  authorizationCode,
  nonce,
  locale = "en",
  deviceName,
  platform,
  appVersion,
  ipAddress,
  userAgent,
}) {
  if (!authorizationCode) {
    throw createAuthError(
      "MISSING_APPLE_AUTHORIZATION_CODE",
      "The Apple authorization code is required.",
      400,
    );
  }

  const appleIdentity = await verifyAppleIdentityToken(identityToken, nonce);

  const appleTokens = await exchangeAppleAuthorizationCode(authorizationCode);

  const encryptedAppleRefreshToken = encryptOauthToken(
    appleTokens.refreshToken,
  );

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const userResult = await client.query(
      `
        SELECT
          ui.id AS user_identity_id,

          u.id,
          u.email,
          u.display_name,
          u.locale,
          u.timezone,
          u.status,
          u.onboarding_completed_at

        FROM user_identities ui

        INNER JOIN users u
          ON u.id = ui.user_id

        WHERE ui.provider = 'apple'
          AND ui.provider_subject = $1
          AND u.deleted_at IS NULL

        LIMIT 1

        FOR UPDATE OF u, ui
      `,
      [appleIdentity.subject],
    );

    let user;
    let userIdentityId;

    if (userResult.rowCount > 0) {
      user = userResult.rows[0];
      userIdentityId = userResult.rows[0].user_identity_id;

      await client.query(
        `
          UPDATE user_identities

          SET
            provider_email = COALESCE($2, provider_email),
            email_verified_at = CASE
              WHEN $3 THEN COALESCE(email_verified_at, NOW())
              ELSE email_verified_at
            END,
            last_used_at = NOW()

          WHERE provider = 'apple'
            AND provider_subject = $1
        `,
        [
          appleIdentity.subject,
          appleIdentity.email,
          appleIdentity.emailVerified,
        ],
      );

      await client.query(
        `
          UPDATE users

          SET
            last_login_at = NOW(),
            updated_at = NOW()

          WHERE id = $1
        `,
        [user.id],
      );
    } else {
      if (!appleIdentity.email || !appleIdentity.emailVerified) {
        throw createAuthError(
          "APPLE_EMAIL_REQUIRED",
          "A verified email address is required to create a Nelo account.",
          400,
        );
      }

      /*
       * Si cette adresse possède déjà un compte Nelo, l’identité
       * Apple vérifiée est associée à cet utilisateur.
       */
      const existingUserResult = await client.query(
        `
          SELECT
            id,
            email,
            display_name,
            locale,
            timezone,
            status,
            onboarding_completed_at

          FROM users

          WHERE LOWER(email) = $1
            AND deleted_at IS NULL

          LIMIT 1

          FOR UPDATE
        `,
        [appleIdentity.email],
      );

      if (existingUserResult.rowCount > 0) {
        user = existingUserResult.rows[0];

        await client.query(
          `
            UPDATE users

            SET
              email_verified_at = COALESCE(email_verified_at, NOW()),
              last_login_at = NOW(),
              updated_at = NOW()

            WHERE id = $1
          `,
          [user.id],
        );
      } else {
        const createdUserResult = await client.query(
          `
            INSERT INTO users (
              email,
              locale,
              email_verified_at,
              last_login_at
            )
            VALUES ($1, $2, NOW(), NOW())

            RETURNING
              id,
              email,
              display_name,
              locale,
              timezone,
              status,
              onboarding_completed_at
          `,
          [appleIdentity.email, locale],
        );

        user = createdUserResult.rows[0];
      }

      const createdIdentityResult = await client.query(
        `
    INSERT INTO user_identities (
      user_id,
      provider,
      provider_subject,
      provider_email,
      email_verified_at,
      last_used_at
    )
    VALUES (
      $1,
      'apple',
      $2,
      $3,
      NOW(),
      NOW()
    )

    RETURNING id
  `,
        [user.id, appleIdentity.subject, appleIdentity.email],
      );

      userIdentityId = createdIdentityResult.rows[0].id;
    }

    if (user.status === "suspended") {
      throw createAuthError(
        "ACCOUNT_SUSPENDED",
        "This account has been suspended.",
        403,
      );
    }

    await client.query(
      `
    INSERT INTO oauth_credentials (
      user_identity_id,
      encrypted_refresh_token,
      encryption_iv,
      encryption_auth_tag
    )
    VALUES ($1, $2, $3, $4)

    ON CONFLICT (user_identity_id)

    DO UPDATE SET
      encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
      encryption_iv = EXCLUDED.encryption_iv,
      encryption_auth_tag = EXCLUDED.encryption_auth_tag,
      updated_at = NOW(),
      revoked_at = NULL
  `,
      [
        userIdentityId,
        encryptedAppleRefreshToken.encryptedToken,
        encryptedAppleRefreshToken.initializationVector,
        encryptedAppleRefreshToken.authenticationTag,
      ],
    );

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const sessionResult = await client.query(
      `
        INSERT INTO user_sessions (
          user_id,
          refresh_token_hash,
          device_name,
          platform,
          app_version,
          ip_address,
          user_agent,
          expires_at,
          last_used_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW() + ($8 * INTERVAL '1 day'),
          NOW()
        )
        RETURNING id
      `,
      [
        user.id,
        refreshTokenHash,
        deviceName || null,
        platform || "ios",
        appVersion || null,
        ipAddress || null,
        userAgent || null,
        REFRESH_TOKEN_DURATION_DAYS,
      ],
    );

    const accessToken = generateAccessToken({
      userId: user.id,
      sessionId: sessionResult.rows[0].id,
    });

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 15 * 60,

      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale,
        timezone: user.timezone,
        onboardingCompletedAt: user.onboarding_completed_at,
      },
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function signInWithGoogle({
  idToken,
  locale = "en",
  deviceName,
  platform,
  appVersion,
  ipAddress,
  userAgent,
}) {
  const googleIdentity = await verifyGoogleIdentityToken(idToken);
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const identityUserResult = await client.query(
      `
        SELECT
          u.id,
          u.email,
          u.display_name,
          u.locale,
          u.timezone,
          u.status,
          u.onboarding_completed_at
        FROM user_identities ui
        INNER JOIN users u
          ON u.id = ui.user_id
        WHERE ui.provider = 'google'
          AND ui.provider_subject = $1
          AND u.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF u, ui
      `,
      [googleIdentity.subject],
    );

    let user;

    if (identityUserResult.rowCount > 0) {
      user = identityUserResult.rows[0];

      await client.query(
        `
          UPDATE user_identities
          SET
            provider_email = COALESCE($2, provider_email),
            email_verified_at = CASE
              WHEN $3 THEN COALESCE(email_verified_at, NOW())
              ELSE email_verified_at
            END,
            last_used_at = NOW()
          WHERE provider = 'google'
            AND provider_subject = $1
        `,
        [
          googleIdentity.subject,
          googleIdentity.email,
          googleIdentity.emailVerified,
        ],
      );

      await client.query(
        `
          UPDATE users
          SET
            last_login_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `,
        [user.id],
      );
    } else {
      if (!googleIdentity.email || !googleIdentity.emailVerified) {
        throw createAuthError(
          "GOOGLE_EMAIL_REQUIRED",
          "A verified email address is required to create a Nelo account.",
          400,
        );
      }

      const existingUserResult = await client.query(
        `
          SELECT
            id,
            email,
            display_name,
            locale,
            timezone,
            status,
            onboarding_completed_at
          FROM users
          WHERE LOWER(email) = $1
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [googleIdentity.email],
      );

      if (existingUserResult.rowCount > 0) {
        user = existingUserResult.rows[0];

        if (user.status === "suspended") {
          throw createAuthError(
            "ACCOUNT_SUSPENDED",
            "This account has been suspended.",
            403,
          );
        }

        const linkedGoogleResult = await client.query(
          `
            SELECT provider_subject
            FROM user_identities
            WHERE user_id = $1
              AND provider = 'google'
            LIMIT 1
            FOR UPDATE
          `,
          [user.id],
        );

        if (
          linkedGoogleResult.rowCount > 0 &&
          linkedGoogleResult.rows[0].provider_subject !== googleIdentity.subject
        ) {
          throw createAuthError(
            "NELO_ACCOUNT_ALREADY_LINKED_TO_GOOGLE",
            "This Nelo account is already linked to another Google account.",
            409,
          );
        }

        if (!isGoogleAuthoritativeForEmail(googleIdentity)) {
          await client.query("COMMIT");
          transactionOpen = false;

          return {
            verificationRequired: true,
            email: googleIdentity.email,
          };
        }

        await client.query(
          `
            UPDATE users
            SET
              email_verified_at = COALESCE(email_verified_at, NOW()),
              last_login_at = NOW(),
              updated_at = NOW()
            WHERE id = $1
          `,
          [user.id],
        );
      } else {
        const createdUserResult = await client.query(
          `
            INSERT INTO users (
              email,
              locale,
              email_verified_at,
              last_login_at
            )
            VALUES ($1, $2, NOW(), NOW())
            RETURNING
              id,
              email,
              display_name,
              locale,
              timezone,
              status,
              onboarding_completed_at
          `,
          [googleIdentity.email, locale],
        );

        user = createdUserResult.rows[0];
      }

      await attachGoogleIdentity(client, user.id, googleIdentity);
    }

    if (user.status === "suspended") {
      throw createAuthError(
        "ACCOUNT_SUSPENDED",
        "This account has been suspended.",
        403,
      );
    }

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const sessionResult = await client.query(
      `
        INSERT INTO user_sessions (
          user_id,
          refresh_token_hash,
          device_name,
          platform,
          app_version,
          ip_address,
          user_agent,
          expires_at,
          last_used_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW() + ($8 * INTERVAL '1 day'),
          NOW()
        )
        RETURNING id
      `,
      [
        user.id,
        refreshTokenHash,
        deviceName || null,
        platform || "unknown",
        appVersion || null,
        ipAddress || null,
        userAgent || null,
        REFRESH_TOKEN_DURATION_DAYS,
      ],
    );

    const accessToken = generateAccessToken({
      userId: user.id,
      sessionId: sessionResult.rows[0].id,
    });

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale,
        timezone: user.timezone,
        onboardingCompletedAt: user.onboarding_completed_at,
      },
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function refreshSession({ refreshToken, ipAddress, userAgent }) {
  const currentRefreshTokenHash = hashRefreshToken(refreshToken);
  const client = await pool.connect();

  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const result = await client.query(
      `
        SELECT
          s.id AS session_id,
          s.user_id,
          s.expires_at,
          u.status
        FROM user_sessions s
        INNER JOIN users u
          ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1
          AND s.revoked_at IS NULL
          AND u.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF s
      `,
      [currentRefreshTokenHash],
    );

    if (result.rowCount === 0) {
      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "INVALID_REFRESH_TOKEN",
        "The refresh token is invalid.",
      );
    }

    const session = result.rows[0];

    if (new Date(session.expires_at) <= new Date()) {
      await client.query(
        `
          UPDATE user_sessions
          SET revoked_at = NOW()
          WHERE id = $1
        `,
        [session.session_id],
      );

      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "REFRESH_TOKEN_EXPIRED",
        "The session has expired. Please sign in again.",
      );
    }

    if (session.status !== "active") {
      await client.query(
        `
          UPDATE user_sessions
          SET revoked_at = NOW()
          WHERE id = $1
        `,
        [session.session_id],
      );

      await client.query("COMMIT");
      transactionOpen = false;

      throw createAuthError(
        "ACCOUNT_UNAVAILABLE",
        "This account is not available.",
        403,
      );
    }

    // Rotation : l’ancien refresh token devient immédiatement inutilisable.
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    await client.query(
      `
        UPDATE user_sessions
        SET
          refresh_token_hash = $1,
          last_used_at = NOW(),
          ip_address = $2,
          user_agent = $3
        WHERE id = $4
      `,
      [
        newRefreshTokenHash,
        ipAddress || null,
        userAgent || null,
        session.session_id,
      ],
    );

    const newAccessToken = generateAccessToken({
      userId: session.user_id,
      sessionId: session.session_id,
    });

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresIn: 15 * 60,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function logout(refreshToken) {
  const refreshTokenHash = hashRefreshToken(refreshToken);

  await pool.query(
    `
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE refresh_token_hash = $1
    `,
    [refreshTokenHash],
  );
}

module.exports = {
  requestLoginCode,
  verifyLoginCode,
  signInWithApple,
  signInWithGoogle,
  refreshSession,
  logout,
};
