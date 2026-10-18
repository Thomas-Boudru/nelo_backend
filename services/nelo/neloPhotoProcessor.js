const { processTrackingImage } = require("../storage/trackingImageProcessor");

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

function photoError(code, message, status = 400) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

async function processNeloPhoto(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw photoError("NELO_PHOTO_REQUIRED", "Choose a photo to send.");
  }

  if (fileBuffer.length > MAX_PHOTO_SIZE_BYTES) {
    throw photoError(
      "NELO_PHOTO_TOO_LARGE",
      "The photo must not exceed 5 MB.",
      413,
    );
  }

  let image;

  try {
    image = await processTrackingImage(fileBuffer);
  } catch (error) {
    if (error?.code === "INVALID_TRACKING_IMAGE") {
      throw photoError(
        "NELO_INVALID_PHOTO",
        "This photo could not be processed. Try another photo.",
      );
    }

    throw error;
  }

  // La conversion peut modifier la taille du fichier.
  // On contrôle également le résultat.
  if (image.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    throw photoError(
      "NELO_PHOTO_TOO_LARGE",
      "The processed photo must not exceed 5 MB.",
      413,
    );
  }

  return image;
}

module.exports = {
  processNeloPhoto,
};
