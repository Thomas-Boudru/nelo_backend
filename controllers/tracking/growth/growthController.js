const growthService = require("../../../services/tracking/growth/growthService");

async function getGrowthEntry(req, res, next) {
  try {
    const entry = await growthService.getGrowthEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createGrowthEntry(req, res, next) {
  try {
    const result = await growthService.createGrowthEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateGrowthEntry(req, res, next) {
  try {
    const entry = await growthService.updateGrowthEntry({
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

async function getLatestGrowthMeasurements(req, res, next) {
  try {
    const measurements = await growthService.getLatestGrowthMeasurements({
      childId: req.params.childId,
      userId: req.auth.userId,
      onOrBefore: req.query.onOrBefore,
      excludeEntryId: req.query.excludeEntryId,
    });

    return res.status(200).json({ measurements });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getGrowthEntry,
  createGrowthEntry,
  updateGrowthEntry,
  getLatestGrowthMeasurements,
};
