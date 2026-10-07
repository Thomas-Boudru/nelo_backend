const medicationService = require("../../../services/tracking/medication/medicationService");

async function getMedicationEntry(req, res, next) {
  try {
    const entry = await medicationService.getMedicationEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createMedicationEntry(req, res, next) {
  try {
    const result = await medicationService.createMedicationEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateMedicationEntry(req, res, next) {
  try {
    const entry = await medicationService.updateMedicationEntry({
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
  getMedicationEntry,
  createMedicationEntry,
  updateMedicationEntry,
};
