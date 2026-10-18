const {
  sendMessage: sendConversationMessage,
} = require("../../services/nelo/neloMessageService");

async function executeSend(req, res, next, photoFile = null) {
  try {
    const result = await sendConversationMessage({
      childId: req.params.childId,
      conversationId: req.params.conversationId,
      userId: req.auth.userId,
      data: req.body,
      photoFile,
    });

    res.set("Cache-Control", "no-store");

    return res.status(result.replayed ? 200 : 202).json(result);
  } catch (error) {
    return next(error);
  }
}

async function sendMessage(req, res, next) {
  return executeSend(req, res, next);
}

async function sendMessageWithPhoto(req, res, next) {
  if (!req.file) {
    const error = new Error("Choose a photo to send.");

    error.code = "NELO_PHOTO_REQUIRED";
    error.status = 400;

    return next(error);
  }

  return executeSend(req, res, next, req.file);
}

module.exports = {
  sendMessage,
  sendMessageWithPhoto,
};
