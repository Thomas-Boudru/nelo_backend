const childrenService = require("../../services/children/childrenService");

const childAvatarService = require("../../services/children/childAvatarService");

function createControllerError(code, message, status) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

async function getAccessibleChildren(req, res, next) {
  try {
    const children = await childrenService.getAccessibleChildren(
      req.auth.userId,
    );

    return res.status(200).json({
      children,
    });
  } catch (error) {
    return next(error);
  }
}

async function saveChildAvatar(req, res, next) {
  try {
    if (!req.file) {
      throw createControllerError(
        "MISSING_AVATAR_FILE",
        "An avatar image is required.",
        400,
      );
    }

    const avatar = await childAvatarService.saveChildAvatar({
      childId: req.params.childId,
      userId: req.auth.userId,
      originalFilename: req.file.originalname,
      fileBuffer: req.file.buffer,
    });

    return res.status(200).json({
      avatar,
    });
  } catch (error) {
    return next(error);
  }
}

async function removeChildAvatar(req, res, next) {
  try {
    const result = await childAvatarService.removeChildAvatar({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({
      removed: result.removed,
      avatar: null,
    });
  } catch (error) {
    return next(error);
  }
}

async function createChild(req, res, next) {
  try {
    const child = await childrenService.createChild({
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(201).json({
      child,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateChild(req, res, next) {
  try {
    const child = await childrenService.updateChild({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(200).json({
      child,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateChildPreferences(req, res, next) {
  try {
    const preferences = await childrenService.updateChildPreferences({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(200).json({
      preferences,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createChild,
  getAccessibleChildren,
  removeChildAvatar,
  saveChildAvatar,
  updateChild,
  updateChildPreferences,
};
