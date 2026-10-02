const service = require("../../../services/tracking/feed/breastfeedingService");

async function getBreastfeedingEntry(req, res, next) {
  try {
    const entry = await service.getBreastfeedingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createBreastfeedingEntry(req, res, next) {
  try {
    const result = await service.createBreastfeedingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateBreastfeedingEntry(req, res, next) {
  try {
    const entry = await service.updateBreastfeedingEntry({
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
  getBreastfeedingEntry,
  createBreastfeedingEntry,
  updateBreastfeedingEntry,
};
