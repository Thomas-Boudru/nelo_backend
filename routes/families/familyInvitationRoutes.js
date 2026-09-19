const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  createFamilyInvitation,
  resendFamilyInvitation,
  revokeFamilyInvitation,
} = require("../../controllers/families/familyInvitationController");

const router = express.Router();

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

module.exports = router;
