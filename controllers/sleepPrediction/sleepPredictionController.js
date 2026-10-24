const {
  getChildSleepPredictionForUser,
} = require("../../services/sleepPrediction/sleepPredictionService");

async function getChildSleepPrediction(req, res, next) {
  try {
    const prediction = await getChildSleepPredictionForUser({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({
      prediction,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getChildSleepPrediction,
};
