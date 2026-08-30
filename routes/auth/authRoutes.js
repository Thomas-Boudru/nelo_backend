const express = require("express");

const authLimiter = require("../../middleware/authLimiter");

const {
  requestLoginCode,
  verifyLoginCode,
  signInWithApple,
  signInWithGoogle,
  refreshSession,
  logout,
} = require("../../controllers/auth/authController");

const router = express.Router();

router.post("/code/request", authLimiter, requestLoginCode);
router.post("/code/verify", authLimiter, verifyLoginCode);
router.post("/apple", authLimiter, signInWithApple);
router.post("/google", authLimiter, signInWithGoogle);
router.post("/refresh", refreshSession);
router.post("/logout", logout);

module.exports = router;
