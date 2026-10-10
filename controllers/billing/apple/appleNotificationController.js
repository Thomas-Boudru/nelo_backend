const { z } = require("zod");

const {
  receiveAppleNotification,
} = require("../../../services/billing/apple/appleNotificationService");

const notificationSchema = z.object({
  signedPayload: z.string().trim().min(1).max(500000),
});

async function receiveNotification(req, res, next) {
  try {
    const validation = notificationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_APPLE_NOTIFICATION_REQUEST",
          message: "A valid signedPayload is required.",
        },
      });
    }

    await receiveAppleNotification({
      signedPayload: validation.data.signedPayload,
    });

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  receiveNotification,
};
