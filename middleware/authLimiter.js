const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_AUTH_REQUESTS",
      message: "Too many authentication attempts. Please try again later.",
    },
  },
});

module.exports = authLimiter;
