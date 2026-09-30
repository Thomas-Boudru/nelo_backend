const bottleService = require("../../../services/tracking/feed/bottleService");

async function getBottleEntry(req, res, next) {
  try {
    const entry = await bottleService.getBottleEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createBottleEntry(req, res, next) {
  try {
    const result = await bottleService.createBottleEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateBottleEntry(req, res, next) {
  try {
    const entry = await bottleService.updateBottleEntry({
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
  getBottleEntry,
  createBottleEntry,
  updateBottleEntry,
};
