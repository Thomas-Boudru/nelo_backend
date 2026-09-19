const express = require("express");

const {
  getFamilyInvitationPreview,
} = require("../../controllers/families/familyInvitationController");

const router = express.Router();

/*
 * Route publique :
 * aucun middleware authenticate ici.
 */
router.get("/preview", getFamilyInvitationPreview);

module.exports = router;
