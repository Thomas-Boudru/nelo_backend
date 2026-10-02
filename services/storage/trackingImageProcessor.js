const sharp = require("sharp");

function imageError(message) {
  const error = new Error(message);

  error.code = "INVALID_TRACKING_IMAGE";
  error.status = 400;

  return error;
}

async function processTrackingImage(fileBuffer) {
  if (
    !Buffer.isBuffer(fileBuffer) ||
    fileBuffer.length === 0 ||
    fileBuffer.length > 10 * 1024 * 1024
  ) {
    throw imageError("The image must not exceed 10 MB.");
  }

  try {
    const options = {
      limitInputPixels: 40_000_000,
      animated: false,
      failOn: "warning",
    };

    const metadata = await sharp(fileBuffer, options).metadata();

    if (
      !["jpeg", "png", "webp", "heif"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    ) {
      throw imageError("Unsupported image format.");
    }

    const { data, info } = await sharp(fileBuffer, options)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      mimeType: "image/webp",
      extension: "webp",
      sizeBytes: data.length,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error.code === "INVALID_TRACKING_IMAGE") {
      throw error;
    }

    throw imageError("The image could not be processed.");
  }
}

module.exports = { processTrackingImage };
