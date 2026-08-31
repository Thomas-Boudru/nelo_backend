const { S3Client } = require("@aws-sdk/client-s3");

let r2Client = null;

function getRequiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getR2Client() {
  if (r2Client) {
    return r2Client;
  }

  const accountId = getRequiredEnvironmentVariable("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnvironmentVariable("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnvironmentVariable(
    "R2_SECRET_ACCESS_KEY",
  );

  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return r2Client;
}

function getR2BucketName() {
  return getRequiredEnvironmentVariable("R2_BUCKET_NAME");
}

module.exports = {
  getR2Client,
  getR2BucketName,
};
