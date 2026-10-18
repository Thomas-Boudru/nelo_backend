const {
  requireNeloPhotoAccess: checkPhotoAccess,
} = require("../services/nelo/neloPhotoAccessService");

async function requireNeloPhotoAccess(req, res, next) {
  try {
    await checkPhotoAccess({
      childId: req.params.childId,
      conversationId: req.params.conversationId,
      userId: req.auth.userId,
    });

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireNeloPhotoAccess,
};
