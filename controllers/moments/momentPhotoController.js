const momentPhotoService = require("../../services/moments/momentPhotoService");

async function listMomentPhotos(req, res, next) {
  try {
    const photos = await momentPhotoService.listMomentPhotos({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
    });

    return res.status(200).json({ photos });
  } catch (error) {
    return next(error);
  }
}

async function uploadMomentPhoto(req, res, next) {
  try {
    if (!req.file) {
      const error = new Error("A photo is required.");

      error.code = "MISSING_MOMENT_PHOTO";
      error.status = 400;

      throw error;
    }

    const result = await momentPhotoService.uploadMomentPhoto({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
      attachmentId: req.params.attachmentId,
      originalFilename: req.file.originalname,
      fileBuffer: req.file.buffer,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function deleteMomentPhoto(req, res, next) {
  try {
    const result = await momentPhotoService.deleteMomentPhoto({
      childId: req.params.childId,
      userId: req.auth.userId,
      momentId: req.params.momentId,
      attachmentId: req.params.attachmentId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listMomentPhotos,
  uploadMomentPhoto,
  deleteMomentPhoto,
};
