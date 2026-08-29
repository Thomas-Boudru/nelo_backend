const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: false },
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

module.exports = pool;
