const dailyMessagesService = require("../../services/dailyMessages/dailyMessagesService");

function getLanguage(req) {
  return req.query.language || req.headers["accept-language"] || "en";
}

async function getToday(req, res, next) {
  try {
    const result = await dailyMessagesService.getToday({
      childId: req.params.childId,
      userId: req.auth.userId,
      language: getLanguage(req),
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function getHistory(req, res, next) {
  try {
    const rawLimit = Number(req.query.limit ?? 30);
    const rawOffset = Number(req.query.offset ?? 0);

    if (
      !Number.isInteger(rawLimit) ||
      rawLimit < 1 ||
      !Number.isInteger(rawOffset) ||
      rawOffset < 0
    ) {
      const error = new Error("Invalid pagination parameters.");
      error.code = "INVALID_PAGINATION";
      error.status = 400;
      throw error;
    }

    const history = await dailyMessagesService.getHistory({
      childId: req.params.childId,
      userId: req.auth.userId,
      language: getLanguage(req),
      limit: Math.min(rawLimit, 100),
      offset: rawOffset,
    });

    return res.status(200).json({ history });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const message = await dailyMessagesService.getById({
      childId: req.params.childId,
      userId: req.auth.userId,
      messageId: req.params.messageId,
      language: getLanguage(req),
    });

    return res.status(200).json({ message });
  } catch (error) {
    return next(error);
  }
}

async function getCatalog(req, res, next) {
  try {
    const messages = await dailyMessagesService.getCatalog({
      childId: req.params.childId,
      userId: req.auth.userId,
      language: getLanguage(req),
    });

    return res.status(200).json({ messages });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getToday,
  getHistory,
  getById,
  getCatalog,
};
