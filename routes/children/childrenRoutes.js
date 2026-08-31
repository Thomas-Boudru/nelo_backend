const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getAccessibleChildren,
} = require("../../controllers/children/childrenController");

const router = express.Router();

router.get("/", authenticate, getAccessibleChildren);

module.exports = router;
