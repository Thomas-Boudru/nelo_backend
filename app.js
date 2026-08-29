require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const logger = require("morgan");
const pool = require("./db/pool");

const limiter = require("./limiter");

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true,
  }),
);

app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(limiter);

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

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "Route not found.",
    },
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  res.status(error.status || 500).json({
    error: {
      code: error.code || "INTERNAL_SERVER_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred."
          : error.message,
    },
  });
});

module.exports = app;
