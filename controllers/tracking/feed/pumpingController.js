const pumpingService = require("../../../services/tracking/feed/pumpingService");

async function getPumpingEntry(req, res, next) {
  try {
    const entry = await pumpingService.getPumpingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createPumpingEntry(req, res, next) {
  try {
    const result = await pumpingService.createPumpingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updatePumpingEntry(req, res, next) {
  try {
    const entry = await pumpingService.updatePumpingEntry({
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
  getPumpingEntry,
  createPumpingEntry,
  updatePumpingEntry,
};
