const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  max: 50, // Limite chaque IP à 50 requêtes par 30 secondes
  windowMs: 30 * 1000, // 30 secondes
  message: "Too many requests from this IP, please try again later.",
});

module.exports = limiter;