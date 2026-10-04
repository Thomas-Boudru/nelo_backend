const customMilestoneService = require("../../services/moments/customMilestoneService");
async function listCustomMilestones(req, res, next) {
  try {
    const result = await customMilestoneService.listCustomMilestones({
      childId: req.params.childId,
      userId: req.auth.userId,
      cursor: req.query.cursor,
      limit: req.query.limit,
      includeArchived: req.query.includeArchived,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function createCustomMilestone(req, res, next) {
  try {
    const result = await customMilestoneService.createCustomMilestone({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateCustomMilestone(req, res, next) {
  try {
    const milestone = await customMilestoneService.updateCustomMilestone({
      childId: req.params.childId,
      userId: req.auth.userId,
      milestoneId: req.params.milestoneId,
      data: req.body,
    });

    return res.status(200).json({ milestone });
  } catch (error) {
    return next(error);
  }
}

async function archiveCustomMilestone(req, res, next) {
  try {
    const result = await customMilestoneService.archiveCustomMilestone({
      childId: req.params.childId,
      userId: req.auth.userId,
      milestoneId: req.params.milestoneId,
      data: req.body,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listCustomMilestones,
  createCustomMilestone,
  updateCustomMilestone,
  archiveCustomMilestone,
};
