require("dotenv").config();

const { randomBytes, createHash } = require("node:crypto");
const pool = require("../db/pool");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  if (process.env.BILLING_ENVIRONMENT?.trim() !== "sandbox") {
    throw new Error("This script only works with BILLING_ENVIRONMENT=sandbox.");
  }

  const email = process.argv[2]?.trim();
  const requestedFamilyId = process.argv[3]?.trim();

  if (!email) {
    throw new Error(
      'Usage: node scripts/grantSandboxPremium.js "account@email.com" [familyId]',
    );
  }

  if (requestedFamilyId && !UUID_PATTERN.test(requestedFamilyId)) {
    throw new Error("Invalid family ID.");
  }

  const database = await pool.connect();

  try {
    await database.query("BEGIN");

    const result = await database.query(
      `
        SELECT DISTINCT
          account.id AS user_id,
          account.email,
          family.id AS family_id

        FROM users account

        INNER JOIN family_members fm
          ON fm.user_id = account.id
          AND fm.family_role = 'owner'
          AND fm.removed_at IS NULL

        INNER JOIN families family
          ON family.id = fm.family_id
          AND family.deleted_at IS NULL

        WHERE lower(account.email) = lower($1::text)
          AND account.deleted_at IS NULL
          AND account.status = 'active'
          AND (
            $2::uuid IS NULL
            OR family.id = $2::uuid
          )
      `,
      [email, requestedFamilyId || null],
    );

    if (result.rows.length === 0) {
      throw new Error("No active owned family was found for this account.");
    }

    if (result.rows.length !== 1) {
      console.info(
        "Several matching families were found:",
        result.rows.map((row) => row.family_id),
      );

      throw new Error(
        "Run the command again with the desired family ID as the second argument.",
      );
    }

    const owner = result.rows[0];

    // Sérialise les exécutions de ce script pour cette famille.
    await database.query(
      "SELECT id FROM families WHERE id = $1::uuid FOR UPDATE",
      [owner.family_id],
    );

    const providerPaymentId = `sandbox-premium-test-30-days:${owner.family_id}`;

    const existing = await database.query(
      `
        SELECT
          gift.status,
          grant_access.ends_at,
          grant_access.revoked_at

        FROM subscription_gifts gift

        LEFT JOIN family_access_grants grant_access
          ON grant_access.gift_id = gift.id

        WHERE gift.payment_provider = 'sandbox_test'
          AND gift.environment = 'sandbox'
          AND gift.provider_payment_id = $1::text
      `,
      [providerPaymentId],
    );

    if (existing.rowCount > 0) {
      await database.query("COMMIT");

      console.info("This test access already exists. No changes made.", {
        status: existing.rows[0].status,
        endsAt: existing.rows[0].ends_at,
        revoked: Boolean(existing.rows[0].revoked_at),
      });

      return;
    }

    // Empreinte aléatoire exigée par le schéma des cadeaux.
    // Aucun code échangeable n'est affiché ni distribué.
    const codeHash = createHash("sha256").update(randomBytes(32)).digest("hex");

    const giftResult = await database.query(
      `
        INSERT INTO subscription_gifts (
          plan_code,
          purchased_by_user_id,
          purchaser_email,
          duration_months,
          environment,
          status,
          code_hash,
          payment_provider,
          provider_payment_id,
          amount_paid_minor,
          currency,
          paid_at,
          redeemed_by_user_id,
          redeemed_family_id,
          redeemed_at,
          personal_message
        )
        VALUES (
          'premium',
          $1::uuid,
          $2::text,
          1,
          'sandbox',
          'redeemed',
          $3::text,
          'sandbox_test',
          $4::text,
          0,
          'EUR',
          transaction_timestamp(),
          $1::uuid,
          $5::uuid,
          transaction_timestamp(),
          'Internal sandbox test fixture. No real payment. Access duration: 30 days.'
        )
        RETURNING id
      `,
      [
        owner.user_id,
        owner.email,
        codeHash,
        providerPaymentId,
        owner.family_id,
      ],
    );

    const grantResult = await database.query(
      `
        INSERT INTO family_access_grants (
          family_id,
          plan_code,
          environment,
          gift_id,
          starts_at,
          ends_at
        )
        VALUES (
          $1::uuid,
          'premium',
          'sandbox',
          $2::uuid,
          transaction_timestamp(),
          transaction_timestamp() + INTERVAL '30 days'
        )
        RETURNING ends_at
      `,
      [owner.family_id, giftResult.rows[0].id],
    );

    await database.query("COMMIT");

    console.info("Sandbox Premium access created for 30 days.", {
      familyId: owner.family_id,
      endsAt: grantResult.rows[0].ends_at,
    });
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database.release();
  }
}

main()
  .catch((error) => {
    // Les erreurs SQL peuvent contenir des données dans leurs détails.
    console.error(
      error.code ? `Sandbox grant failed: ${error.code}` : error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
