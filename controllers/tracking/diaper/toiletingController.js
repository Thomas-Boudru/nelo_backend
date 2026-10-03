const toiletingService = require("../../../services/tracking/diaper/toiletingService");

function createController(type) {
  return async function createEntry(req, res, next) {
    try {
      const result = await toiletingService.createToiletingEntry({
        childId: req.params.childId,
        userId: req.auth.userId,
        type,
        data: req.body,
      });

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

function getController(type) {
  return async function getEntry(req, res, next) {
    try {
      const entry = await toiletingService.getToiletingEntry({
        childId: req.params.childId,
        userId: req.auth.userId,
        entryId: req.params.entryId,
        type,
      });

      return res.status(200).json({ entry });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createDiaperEntry: createController("diaper"),
  getDiaperEntry: getController("diaper"),
  createPottyEntry: createController("potty"),
  getPottyEntry: getController("potty"),
};
