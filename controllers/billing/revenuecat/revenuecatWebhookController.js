const { createHash, timingSafeEqual } = require("node:crypto");
const { z } = require("zod");

const {
  saveRevenueCatEvent,
} = require("../../../services/billing/revenuecat/revenuecatWebhookService");

const payloadSchema = z
  .object({
    api_version: z.string().min(1).max(30),

    event: z
      .object({
        id: z.string().trim().min(1).max(255),
        type: z.string().trim().min(1).max(120),

        environment: z.enum(["SANDBOX", "PRODUCTION"]).nullish(),

        event_timestamp_ms: z
          .number()
          .int()
          .positive()
          .max(8640000000000000)
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

function hash(value) {
  return createHash("sha256").update(value).digest();
}

async function receiveRevenueCatWebhook(req, res, next) {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim();

    if (!secret || secret.length < 32) {
      const error = new Error("Missing or invalid RevenueCat webhook secret.");
      error.code = "REVENUECAT_WEBHOOK_CONFIGURATION_ERROR";
      error.status = 500;
      throw error;
    }

    const receivedAuthorization = req.get("authorization") || "";
    const expectedAuthorization = `Bearer ${secret}`;

    if (
      !timingSafeEqual(hash(receivedAuthorization), hash(expectedAuthorization))
    ) {
      return res.status(401).json({
        error: {
          code: "INVALID_WEBHOOK_AUTHORIZATION",
          message: "Invalid webhook authorization.",
        },
      });
    }

    const validation = payloadSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REVENUECAT_EVENT",
          message: "Invalid RevenueCat event.",
        },
      });
    }

    await saveRevenueCatEvent(validation.data);

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  receiveRevenueCatWebhook,
};
