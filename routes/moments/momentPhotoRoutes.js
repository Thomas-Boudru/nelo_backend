const express = require("express");
const multer = require("multer");

const momentPhotoController = require("../../controllers/moments/momentPhotoController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
});

function receivePhoto(req, res, next) {
  upload.single("photo")(req, res, (error) => {
    if (!error) {
      return next();
    }

    const isTooLarge = error.code === "LIMIT_FILE_SIZE";

    const uploadError = new Error(
      isTooLarge ? "The image must not exceed 10 MB." : "Invalid photo upload.",
    );

    uploadError.code = isTooLarge
      ? "MOMENT_PHOTO_TOO_LARGE"
      : "INVALID_MOMENT_PHOTO_UPLOAD";

    uploadError.status = isTooLarge ? 413 : 400;

    return next(uploadError);
  });
}

router.get(
  "/:childId/moments/:momentId/photos",
  momentPhotoController.listMomentPhotos,
);

router.put(
  "/:childId/moments/:momentId/photos/:attachmentId",
  receivePhoto,
  momentPhotoController.uploadMomentPhoto,
);

router.delete(
  "/:childId/moments/:momentId/photos/:attachmentId",
  momentPhotoController.deleteMomentPhoto,
);

module.exports = router;
