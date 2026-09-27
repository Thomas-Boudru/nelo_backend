const userService = require("../../services/users/userService");

async function getCurrentUser(req, res, next) {
  try {
    const user = await userService.getCurrentUser(req.auth.userId);

    return res.status(200).json({
      user,
    });
  } catch (error) {
    return next(error);
  }
}

async function updatePreferredName(req, res, next) {
  try {
    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, "displayName")
    ) {
      const error = new Error("Only displayName can be updated.");
      error.status = 400;
      error.code = "INVALID_USER_UPDATE";
      throw error;
    }

    const user = await userService.updatePreferredName(
      req.auth.userId,
      body.displayName,
    );

    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCurrentUser,
  updatePreferredName,
};
