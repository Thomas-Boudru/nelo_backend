const express = require("express");
const multer = require("multer");

const {
  listTrackingPhotos,
  uploadTrackingPhoto,
  deleteTrackingPhoto,
} = require("../../controllers/tracking/trackingPhotoController");

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
    if (!error) return next();

    const uploadError = new Error(
      error.code === "LIMIT_FILE_SIZE"
        ? "The image must not exceed 10 MB."
        : "Invalid photo upload.",
    );

    uploadError.code =
      error.code === "LIMIT_FILE_SIZE"
        ? "TRACKING_PHOTO_TOO_LARGE"
        : "INVALID_TRACKING_PHOTO_UPLOAD";

    uploadError.status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;

    return next(uploadError);
  });
}

router.get("/:childId/tracking/:entryId/photos", listTrackingPhotos);

router.put(
  "/:childId/tracking/:entryId/photos/:attachmentId",
  receivePhoto,
  uploadTrackingPhoto,
);

router.delete(
  "/:childId/tracking/:entryId/photos/:attachmentId",
  deleteTrackingPhoto,
);

module.exports = router;
