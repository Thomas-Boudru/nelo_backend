const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  acceptFamilyInvitation,
  getFamilyInvitationPreview,
  getPendingFamilyInvitations,
} = require("../../controllers/families/familyInvitationController");

const router = express.Router();

/*
 * Route publique utilisée par joinnelo.app.
 */
router.get("/preview", getFamilyInvitationPreview);

/*
 * Routes authentifiées utilisées par l'application Nelo.
 */
router.get("/pending", authenticate, getPendingFamilyInvitations);

router.post("/:invitationId/accept", authenticate, acceptFamilyInvitation);

module.exports = router;
