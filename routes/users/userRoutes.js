const express = require("express");

const authenticate = require("../../middleware/authenticate");

const { getCurrentUser } = require("../../controllers/users/userController");

const router = express.Router();

router.get("/me", authenticate, getCurrentUser);

module.exports = router;
