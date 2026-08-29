const jwt = require("jsonwebtoken");

const pool = require("../db/pool");

async function authenticate(req, res, next) {
  try {
    const authorizationHeader = req.get("authorization");

    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required.",
        },
      });
    }

    const accessToken = authorizationHeader.slice("Bearer ".length).trim();

    if (!accessToken) {
      return res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required.",
        },
      });
    }

    if (!process.env.ACCESS_TOKEN_SECRET) {
      throw new Error("Missing ACCESS_TOKEN_SECRET environment variable.");
    }

    let payload;

    try {
      payload = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET, {
        issuer: "nelo-api",
        audience: "nelo-app",
      });
    } catch (error) {
      const isExpired = error.name === "TokenExpiredError";

      return res.status(401).json({
        error: {
          code: isExpired ? "ACCESS_TOKEN_EXPIRED" : "INVALID_ACCESS_TOKEN",
          message: isExpired
            ? "The access token has expired."
            : "The access token is invalid.",
        },
      });
    }

    if (!payload.sub || !payload.sessionId) {
      return res.status(401).json({
        error: {
          code: "INVALID_ACCESS_TOKEN",
          message: "The access token is invalid.",
        },
      });
    }

    const result = await pool.query(
      `
        SELECT
          u.id AS user_id,
          u.email,
          u.status,
          s.id AS session_id
        FROM users u
        INNER JOIN user_sessions s
          ON s.user_id = u.id
        WHERE u.id = $1
          AND s.id = $2
          AND u.deleted_at IS NULL
          AND u.status = 'active'
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        LIMIT 1
      `,
      [payload.sub, payload.sessionId],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: {
          code: "INVALID_SESSION",
          message: "The session is no longer valid.",
        },
      });
    }

    req.auth = {
      userId: result.rows[0].user_id,
      sessionId: result.rows[0].session_id,
      email: result.rows[0].email,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;
