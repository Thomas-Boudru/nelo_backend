const { z } = require("zod");

const authService = require("../../services/auth/authService");

const requestLoginCodeSchema = z.object({
  email: z.string().trim().email("A valid email address is required.").max(320),

  locale: z.enum(["fr", "en", "de", "es", "it", "nl", "pt"]).default("en"),
});

const verifyLoginCodeSchema = z.object({
  email: z.string().trim().email("A valid email address is required.").max(320),

  code: z
    .string()
    .regex(/^\d{6}$/, "The login code must contain exactly 6 digits."),

  locale: z.enum(["fr", "en", "de", "es", "it", "nl", "pt"]).default("en"),

  deviceName: z.string().trim().max(150).optional(),
  platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
  appVersion: z.string().trim().max(30).optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(32, "A valid refresh token is required.")
    .max(500),
});

async function requestLoginCode(req, res, next) {
  try {
    const validation = requestLoginCodeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: validation.error.issues[0].message,
        },
      });
    }

    const result = await authService.requestLoginCode({
      email: validation.data.email,
      locale: validation.data.locale,
      ipAddress: req.ip,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function verifyLoginCode(req, res, next) {
  try {
    const validation = verifyLoginCodeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: validation.error.issues[0].message,
        },
      });
    }

    const result = await authService.verifyLoginCode({
      ...validation.data,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function refreshSession(req, res, next) {
  try {
    const validation = refreshTokenSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: validation.error.issues[0].message,
        },
      });
    }

    const result = await authService.refreshSession({
      refreshToken: validation.data.refreshToken,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    const validation = refreshTokenSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: validation.error.issues[0].message,
        },
      });
    }

    await authService.logout(validation.data.refreshToken);

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requestLoginCode,
  verifyLoginCode,
  refreshSession,
  logout,
};
