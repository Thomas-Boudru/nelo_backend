const conversationService = require("../../services/nelo/neloConversationService");

async function createConversation(req, res, next) {
  try {
    const conversation = await conversationService.createConversation({
      childId: req.params.childId,
      userId: req.auth.userId,
      title: req.body?.title,
    });

    res.set("Cache-Control", "no-store");

    return res.status(201).json({ conversation });
  } catch (error) {
    return next(error);
  }
}

async function listConversations(req, res, next) {
  try {
    const result = await conversationService.listConversations({
      childId: req.params.childId,
      userId: req.auth.userId,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listMessages(req, res, next) {
  try {
    const result = await conversationService.listMessages({
      childId: req.params.childId,
      userId: req.auth.userId,
      conversationId: req.params.conversationId,
      limit: req.query.limit,
      beforeSequence: req.query.beforeSequence,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createConversation,
  listConversations,
  listMessages,
};
