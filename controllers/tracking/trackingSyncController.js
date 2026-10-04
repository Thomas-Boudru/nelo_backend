const trackingSyncService = require("../../services/tracking/trackingSyncService");

async function getTrackingSyncPage(req, res, next) {
  try {
    const result = await trackingSyncService.getTrackingSyncPage({
      childId: req.params.childId,
      userId: req.auth.userId,
      query: req.query,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTrackingSyncPage,
};
