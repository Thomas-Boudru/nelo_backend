const teethingService = require("../../../services/tracking/teething/teethingService");

async function getTeethingEntry(req, res, next) {
  try {
    const entry = await teethingService.getTeethingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createTeethingEntry(req, res, next) {
  try {
    const result = await teethingService.createTeethingEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateTeethingEntry(req, res, next) {
  try {
    const entry = await teethingService.updateTeethingEntry({
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
  getTeethingEntry,
  createTeethingEntry,
  updateTeethingEntry,
};
