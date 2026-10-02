const service = require("../../../services/tracking/feed/solidFeedingService");

async function getSolidFeedingEntry(req, res, next) {
  try {
    const entry = await service.getSolidFeedingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createSolidFeedingEntry(req, res, next) {
  try {
    const result = await service.createSolidFeedingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateSolidFeedingEntry(req, res, next) {
  try {
    const entry = await service.updateSolidFeedingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
      data: req.body,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSolidFeedingEntry,
  createSolidFeedingEntry,
  updateSolidFeedingEntry,
};
