const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  createFamilyInvitation,
  getChildSharing,
  removeChildMember,
  resendFamilyInvitation,
  revokeFamilyInvitation,
} = require("../../controllers/families/familyInvitationController");

const router = express.Router();

router.get("/:childId/sharing", authenticate, getChildSharing);

router.post("/:childId/invitations", authenticate, createFamilyInvitation);

router.post(
  "/:childId/invitations/:invitationId/resend",
  authenticate,
  resendFamilyInvitation,
);

router.delete(
  "/:childId/invitations/:invitationId",
  authenticate,
  revokeFamilyInvitation,
);

router.delete(
  "/:childId/members/:childMemberId",
  authenticate,
  removeChildMember,
);
module.exports = router;
