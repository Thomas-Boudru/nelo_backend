const multer = require("multer");

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function uploadError(code, message, status = 400) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

const photoUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 1,
    fileSize: MAX_PHOTO_SIZE_BYTES,

    // Limites du formulaire multipart, en plus du fichier.
    fields: 8,
    fieldSize: 32 * 1024,
    parts: 9,
  },

  fileFilter(req, file, callback) {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      return callback(
        uploadError(
          "NELO_PHOTO_FORMAT_NOT_SUPPORTED",
          "Choose a JPEG, PNG, or WebP photo.",
          415,
        ),
      );
    }

    return callback(null, true);
  },
});

function uploadNeloPhoto(req, res, next) {
  photoUpload.single("photo")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (!(error instanceof multer.MulterError)) {
      return next(error);
    }

    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return next(
          uploadError(
            "NELO_PHOTO_TOO_LARGE",
            "The photo must not exceed 5 MB.",
            413,
          ),
        );

      case "LIMIT_FILE_COUNT":
      case "LIMIT_UNEXPECTED_FILE":
        return next(
          uploadError(
            "NELO_INVALID_PHOTO_FIELD",
            'Send a single photo in the "photo" field.',
          ),
        );

      default:
        return next(
          uploadError(
            "NELO_INVALID_PHOTO_UPLOAD",
            "The photo upload is invalid.",
          ),
        );
    }
  });
}

module.exports = {
  uploadNeloPhoto,
};
