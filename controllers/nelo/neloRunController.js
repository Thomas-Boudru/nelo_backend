const { getRun: getNeloRun } = require("../../services/nelo/neloRunService");

async function getRun(req, res, next) {
  try {
    const result = await getNeloRun({
      childId: req.params.childId,
      userId: req.auth.userId,
      runId: req.params.runId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getRun,
};
