const sleepService = require("../../../services/tracking/sleep/sleepService");

async function getSleepEntry(req, res, next) {
  try {
    const entry = await sleepService.getSleepEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createSleepEntry(req, res, next) {
  try {
    const result = await sleepService.createSleepEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateSleepEntry(req, res, next) {
  try {
    const entry = await sleepService.updateSleepEntry({
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
  getSleepEntry,
  createSleepEntry,
  updateSleepEntry,
};
