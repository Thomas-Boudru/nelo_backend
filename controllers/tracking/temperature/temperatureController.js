const temperatureService = require("../../../services/tracking/temperature/temperatureService");

async function getTemperatureEntry(req, res, next) {
  try {
    const entry = await temperatureService.getTemperatureEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createTemperatureEntry(req, res, next) {
  try {
    const result = await temperatureService.createTemperatureEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateTemperatureEntry(req, res, next) {
  try {
    const entry = await temperatureService.updateTemperatureEntry({
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
  getTemperatureEntry,
  createTemperatureEntry,
  updateTemperatureEntry,
};
