const bottlePresetService = require("../../../services/tracking/feed/bottlePresetService");

async function getBottlePresets(req, res, next) {
  try {
    const presets = await bottlePresetService.getBottlePresets({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({ presets });
  } catch (error) {
    return next(error);
  }
}

async function createBottlePreset(req, res, next) {
  try {
    const result = await bottlePresetService.createBottlePreset({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function archiveBottlePreset(req, res, next) {
  try {
    const preset = await bottlePresetService.archiveBottlePreset({
      childId: req.params.childId,
      userId: req.auth.userId,
      presetId: req.params.presetId,
    });

    return res.status(200).json({ preset });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getBottlePresets,
  createBottlePreset,
  archiveBottlePreset,
};
