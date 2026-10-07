const vaccinationService = require("../../../services/tracking/medication/vaccinationService");

async function getVaccinationEntry(req, res, next) {
  try {
    const entry = await vaccinationService.getVaccinationEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createVaccinationEntry(req, res, next) {
  try {
    const result = await vaccinationService.createVaccinationEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function getVaccinationReminders(req, res, next) {
  try {
    const reminders = await vaccinationService.getVaccinationReminders({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({ reminders });
  } catch (error) {
    return next(error);
  }
}

async function updateVaccinationEntry(req, res, next) {
  try {
    const entry = await vaccinationService.updateVaccinationEntry({
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
  getVaccinationEntry,
  createVaccinationEntry,
  updateVaccinationEntry,
  getVaccinationReminders,
};
