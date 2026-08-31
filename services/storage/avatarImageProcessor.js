const multer = require("multer");

const MAXIMUM_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function createUploadError(code, message, status = 400) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 1,
    fileSize: MAXIMUM_AVATAR_SIZE_BYTES,
  },

  fileFilter(req, file, callback) {
    if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
      callback(
        createUploadError(
          "UNSUPPORTED_AVATAR_FORMAT",
          "The avatar must be a JPEG, PNG, or WebP image.",
        ),
      );

      return;
    }

    callback(null, true);
  },
});

function uploadChildAvatar(req, res, next) {
  avatarUpload.single("avatar")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          createUploadError(
            "AVATAR_TOO_LARGE",
            "The avatar must not exceed 5 MB.",
          ),
        );

        return;
      }

      if (error.code === "LIMIT_UNEXPECTED_FILE") {
        next(
          createUploadError(
            "INVALID_AVATAR_FIELD",
            'The avatar must be sent in the "avatar" field.',
          ),
        );

        return;
      }

      next(
        createUploadError(
          "INVALID_AVATAR_UPLOAD",
          "The avatar upload is invalid.",
        ),
      );

      return;
    }

    next(error);
  });
}

module.exports = {
  uploadChildAvatar,
};
