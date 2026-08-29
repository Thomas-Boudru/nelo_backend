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

module.exports = {
  getCurrentUser,
};
