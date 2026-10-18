const {
  deleteConversation: deleteConversationService,
} = require("../../services/nelo/neloConversationService");

async function deleteConversation(req, res, next) {
  try {
    const result = await deleteConversationService({
      childId: req.params.childId,
      conversationId: req.params.conversationId,
      userId: req.auth.userId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  deleteConversation,
};
