const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
    },
  },
});

module.exports = limiter;
