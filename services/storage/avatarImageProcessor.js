const sharp = require("sharp");

const AVATAR_WIDTH = 512;
const AVATAR_HEIGHT = 512;
const AVATAR_WEBP_QUALITY = 82;
const MAXIMUM_INPUT_PIXELS = 40_000_000;

function createImageError(code, message, status = 400) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

async function processAvatarImage(fileBuffer) {
  if (!fileBuffer?.length) {
    throw createImageError(
      "MISSING_AVATAR_FILE",
      "An avatar image is required.",
    );
  }

  try {
    const { data, info } = await sharp(fileBuffer, {
      failOn: "error",
      limitInputPixels: MAXIMUM_INPUT_PIXELS,
    })
      // Apply the orientation stored by the camera.
      .rotate()

      // Generate a consistent square avatar.
      .resize(AVATAR_WIDTH, AVATAR_HEIGHT, {
        fit: "cover",
        position: "centre",
      })

      // Convert the image and remove original metadata.
      .webp({
        quality: AVATAR_WEBP_QUALITY,
      })

      .toBuffer({
        resolveWithObject: true,
      });

    return {
      buffer: data,
      mimeType: "image/webp",
      extension: "webp",
      sizeBytes: info.size,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error.code === "MISSING_AVATAR_FILE") {
      throw error;
    }

    throw createImageError(
      "INVALID_AVATAR_IMAGE",
      "The uploaded file is not a valid image.",
    );
  }
}

module.exports = {
  processAvatarImage,
};
