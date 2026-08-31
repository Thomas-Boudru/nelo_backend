const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { getR2BucketName, getR2Client } = require("./r2Client");

const DEFAULT_SIGNED_URL_EXPIRATION_SECONDS = 24 * 60 * 60;

async function uploadObject({
  storageKey,
  body,
  mimeType,
  cacheControl = "private, max-age=86400",
}) {
  if (!storageKey) {
    throw new Error("Missing storage key.");
  }

  if (!body) {
    throw new Error("Missing file content.");
  }

  if (!mimeType) {
    throw new Error("Missing MIME type.");
  }

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: storageKey,
      Body: body,
      ContentType: mimeType,
      CacheControl: cacheControl,
    }),
  );

  return {
    storageKey,
  };
}

async function createSignedDownloadUrl({
  storageKey,
  expiresIn = DEFAULT_SIGNED_URL_EXPIRATION_SECONDS,
}) {
  if (!storageKey) {
    throw new Error("Missing storage key.");
  }

  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: storageKey,
    }),
    {
      expiresIn,
    },
  );
}

async function deleteObject(storageKey) {
  if (!storageKey) {
    return;
  }

  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: storageKey,
    }),
  );
}

module.exports = {
  createSignedDownloadUrl,
  deleteObject,
  uploadObject,
};
