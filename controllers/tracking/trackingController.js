const trackingService = require("../../services/tracking/trackingService");

async function getTrackingEntries(req, res, next) {
  try {
    const result = await trackingService.getTrackingEntries({
      childId: req.params.childId,
      userId: req.auth.userId,
      query: req.query,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function deleteTrackingEntry(req, res, next) {
  try {
    const result = await trackingService.deleteTrackingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
      version: req.body?.version,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTrackingEntries,
  deleteTrackingEntry,
};
