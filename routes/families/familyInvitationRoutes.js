const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  createFamilyInvitation,
} = require("../../controllers/families/familyInvitationController");

const router = express.Router();

router.post("/:childId/invitations", authenticate, createFamilyInvitation);

module.exports = router;
