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

async function getFamilyInvitationPreview(req, res, next) {
  try {
    const invitation = await familyInvitationService.getFamilyInvitationPreview(
      {
        token: req.query?.token,
      },
    );

    return res.status(200).json({
      invitation,
    });
  } catch (error) {
    return next(error);
  }
}

async function getChildSharing(req, res, next) {
  try {
    const sharing = await familyInvitationService.getChildSharing({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({
      sharing,
    });
  } catch (error) {
    return next(error);
  }
}

async function resendFamilyInvitation(req, res, next) {
  try {
    const invitation = await familyInvitationService.resendFamilyInvitation({
      childId: req.params.childId,
      invitationId: req.params.invitationId,
      userId: req.auth.userId,
      locale: req.body?.locale,
    });

    return res.status(200).json({
      invitation,
    });
  } catch (error) {
    return next(error);
  }
}

async function revokeFamilyInvitation(req, res, next) {
  try {
    const invitation = await familyInvitationService.revokeFamilyInvitation({
      childId: req.params.childId,
      invitationId: req.params.invitationId,
      userId: req.auth.userId,
    });

    return res.status(200).json({
      invitation,
    });
  } catch (error) {
    return next(error);
  }
}

async function removeChildMember(req, res, next) {
  try {
    const member = await familyInvitationService.removeChildMember({
      childId: req.params.childId,
      childMemberId: req.params.childMemberId,
      userId: req.auth.userId,
    });

    return res.status(200).json({
      member,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createFamilyInvitation,
  getFamilyInvitationPreview,
  getChildSharing,
  removeChildMember,
  resendFamilyInvitation,
  revokeFamilyInvitation,
};
