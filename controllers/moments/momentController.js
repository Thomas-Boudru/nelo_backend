const momentService = require("../../services/moments/momentService");

async function listMoments(req, res, next) {
  try {
    const result = await momentService.listMoments({
      childId: req.params.childId,
      userId: req.auth.userId,

      filters: {
        types: req.query.types,
        authorIds: req.query.authorIds,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
      },

      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function getMoment(req, res, next) {
  try {
    const moment = await momentService.getMoment({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
    });

    return res.status(200).json({ moment });
  } catch (error) {
    return next(error);
  }
}

async function createMoment(req, res, next) {
  try {
    const result = await momentService.createMoment({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateMoment(req, res, next) {
  try {
    const moment = await momentService.updateMoment({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
      data: req.body,
    });

    return res.status(200).json({ moment });
  } catch (error) {
    return next(error);
  }
}

async function deleteMoment(req, res, next) {
  try {
    const result = await momentService.deleteMoment({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
      data: req.body,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function publishMoment(req, res, next) {
  try {
    const moment = await momentService.publishMoment({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
      data: req.body,
    });

    return res.status(200).json({ moment });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listMoments,
  getMoment,
  createMoment,
  updateMoment,
  deleteMoment,
  publishMoment,
};
