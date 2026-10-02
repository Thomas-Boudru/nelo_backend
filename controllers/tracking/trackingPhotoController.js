const service = require("../../services/tracking/trackingPhotoService");

async function listTrackingPhotos(req, res, next) {
  try {
    const photos = await service.listTrackingPhotos({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ photos });
  } catch (error) {
    return next(error);
  }
}

async function uploadTrackingPhoto(req, res, next) {
  try {
    if (!req.file) {
      const error = new Error("A photo is required.");

      error.code = "MISSING_TRACKING_PHOTO";
      error.status = 400;

      throw error;
    }

    const result = await service.uploadTrackingPhoto({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
      attachmentId: req.params.attachmentId,
      originalFilename: req.file.originalname,
      fileBuffer: req.file.buffer,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function deleteTrackingPhoto(req, res, next) {
  try {
    const result = await service.deleteTrackingPhoto({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
      attachmentId: req.params.attachmentId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listTrackingPhotos,
  uploadTrackingPhoto,
  deleteTrackingPhoto,
};
