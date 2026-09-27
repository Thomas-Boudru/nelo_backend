const express = require("express");

const authenticate = require("../../middleware/authenticate");
const {
  makeChildMemberOwner,
} = require("../../controllers/children/childOwnershipController");

const router = express.Router();

router.patch(
  "/:childId/members/:childMemberId/ownership",
  authenticate,
  makeChildMemberOwner,
);

module.exports = router;
