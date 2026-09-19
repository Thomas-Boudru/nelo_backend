require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const logger = require("morgan");

const pool = require("./db/pool");
const limiter = require("./limiter");
const authRoutes = require("./routes/auth/authRoutes");
const childrenRoutes = require("./routes/children/childrenRoutes");
const onboardingRoutes = require("./routes/onboarding/onboardingRoutes");
const userRoutes = require("./routes/users/userRoutes");
const familyInvitationRoutes = require("./routes/families/familyInvitationRoutes");
const publicInvitationRoutes = require("./routes/families/publicInvitationRoutes");

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.WEBSITE_URL,
  "http://localhost:3000",
  "http://localhost:8081",
  "https://joinnelo.app",
  "https://www.joinnelo.app",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const error = new Error("This origin is not allowed.");
      error.code = "CORS_ORIGIN_NOT_ALLOWED";
      error.status = 403;

      return callback(error);
    },

    credentials: true,
  }),
);

app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.json({
    name: "Nelo API",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/database", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW() AS database_time");

    res.status(200).json({
      status: "healthy",
      database: "connected",
      databaseTime: result.rows[0].database_time,
    });
  } catch (error) {
    next(error);
  }
});

// Protection générale des routes API
app.use("/api", limiter);

// Routes API
app.use("/api/auth", authRoutes);
app.use("/api/children", childrenRoutes);
app.use("/api/children", familyInvitationRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/invitations", publicInvitationRoutes);
app.use("/api", userRoutes);

// Route inconnue
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    },
  });
});

// Gestionnaire centralisé des erreurs
app.use((error, req, res, next) => {
  console.error(error);

  const status = error.status || 500;
  const isUnexpectedError = status >= 500;

  res.status(status).json({
    error: {
      code: error.code || "INTERNAL_SERVER_ERROR",
      message:
        process.env.NODE_ENV === "production" && isUnexpectedError
          ? "An unexpected error occurred."
          : error.message,
    },
  });
});
module.exports = app;
