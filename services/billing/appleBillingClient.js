const fs = require("node:fs");
const path = require("node:path");
const { createPrivateKey } = require("node:crypto");

const {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} = require("@apple/app-store-server-library");

// Ce fichier se trouve dans services/billing/.
const backendRoot = path.resolve(__dirname, "../..");

let cachedConnection = null;

function configurationError(message) {
  const error = new Error(message);
  error.code = "APPLE_BILLING_CONFIGURATION_ERROR";
  error.status = 500;
  return error;
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw configurationError(`Missing ${name} environment variable.`);
  }

  return value;
}

function readConfigurationFile(filePath, label, encoding) {
  try {
    return fs.readFileSync(filePath, encoding);
  } catch {
    throw configurationError(`Unable to read ${label}.`);
  }
}

function getAppleBillingConnection() {
  if (cachedConnection) {
    return cachedConnection;
  }

  const billingEnvironment = requiredEnvironmentVariable("BILLING_ENVIRONMENT");

  if (!["sandbox", "production"].includes(billingEnvironment)) {
    throw configurationError("The billing environment is invalid.");
  }

  const environment =
    billingEnvironment === "production"
      ? Environment.PRODUCTION
      : Environment.SANDBOX;

  const bundleId = requiredEnvironmentVariable("APPLE_BUNDLE_ID");
  const keyId = requiredEnvironmentVariable("APPLE_IAP_KEY_ID");
  const issuerId = requiredEnvironmentVariable("APPLE_IAP_ISSUER_ID");

  const privateKeyPath = path.resolve(
    backendRoot,
    requiredEnvironmentVariable("APPLE_IAP_PRIVATE_KEY_PATH"),
  );

  const privateKey = readConfigurationFile(
    privateKeyPath,
    "the Apple In-App Purchase private key",
    "utf8",
  );

  try {
    const parsedKey = createPrivateKey(privateKey);

    if (
      parsedKey.asymmetricKeyType !== "ec" ||
      parsedKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("Unexpected key type.");
    }
  } catch {
    throw configurationError(
      "The Apple In-App Purchase private key is not a valid P-256 key.",
    );
  }

  const rawAppAppleId = process.env.APPLE_APP_ID?.trim();
  let appAppleId;

  if (rawAppAppleId) {
    if (!/^[1-9][0-9]*$/.test(rawAppAppleId)) {
      throw configurationError(
        "APPLE_APP_ID must be the numeric Apple app identifier.",
      );
    }

    appAppleId = Number(rawAppAppleId);

    if (!Number.isSafeInteger(appAppleId)) {
      throw configurationError("APPLE_APP_ID is invalid.");
    }
  }

  if (billingEnvironment === "production" && !appAppleId) {
    throw configurationError(
      "APPLE_APP_ID is required for production billing.",
    );
  }

  const certificateNames = [
    "AppleIncRootCertificate.cer",
    "AppleRootCA-G2.cer",
    "AppleRootCA-G3.cer",
  ];

  const rootCertificates = certificateNames.map((name) =>
    readConfigurationFile(
      path.join(backendRoot, "certificates", "apple", name),
      `the Apple root certificate ${name}`,
    ),
  );

  const client = new AppStoreServerAPIClient(
    privateKey,
    keyId,
    issuerId,
    bundleId,
    environment,
  );

  const verifier = new SignedDataVerifier(
    rootCertificates,
    true,
    environment,
    bundleId,
    billingEnvironment === "production" ? appAppleId : undefined,
  );

  cachedConnection = {
    client,
    verifier,
    billingEnvironment,
    bundleId,
  };

  return cachedConnection;
}

module.exports = {
  getAppleBillingConnection,
};
