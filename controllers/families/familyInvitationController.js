const familyInvitationService = require("../../services/families/familyInvitationService");

async function createFamilyInvitation(req, res, next) {
  try {
    const invitation = await familyInvitationService.createFamilyInvitation({
      childId: req.params.childId,
      userId: req.auth.userId,
      email: req.body?.email,
      locale: req.body?.locale,
    });

    return res.status(201).json({
      invitation,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createFamilyInvitation,
};
