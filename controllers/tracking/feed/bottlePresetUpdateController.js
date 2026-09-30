const {
  updateBottlePreset,
} = require("../../../services/tracking/feed/bottlePresetUpdateService");

async function updateBottlePresetController(req, res, next) {
  try {
    const preset = await updateBottlePreset({
      userId: req.auth.userId,
      childId: req.params.childId,
      presetId: req.params.presetId,
      data: req.body,
    });

    return res.status(200).json({
      preset,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  updateBottlePresetController,
};
