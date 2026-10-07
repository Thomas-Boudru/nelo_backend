const moodService = require("../../../services/tracking/mood/moodService");

async function getMoodEntry(req, res, next) {
  try {
    const entry = await moodService.getMoodEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createMoodEntry(req, res, next) {
  try {
    const result = await moodService.createMoodEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateMoodEntry(req, res, next) {
  try {
    const entry = await moodService.updateMoodEntry({
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
  getMoodEntry,
  createMoodEntry,
  updateMoodEntry,
};
