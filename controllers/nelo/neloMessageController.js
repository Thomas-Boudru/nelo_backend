const {
  sendMessage: sendConversationMessage,
} = require("../../services/nelo/neloMessageService");

async function sendMessage(req, res, next) {
  try {
    const result = await sendConversationMessage({
      childId: req.params.childId,
      conversationId: req.params.conversationId,
      userId: req.auth.userId,
      data: req.body,
    });

    res.set("Cache-Control", "no-store");

    return res.status(result.replayed ? 200 : 202).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  sendMessage,
};
