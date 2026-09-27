const emailChangeService = require("../../services/users/emailChangeService");

async function requestEmailChange(req, res, next) {
  try {
    const result = await emailChangeService.requestEmailChange({
      userId: req.auth.userId,
      email: req.body?.email,
      locale: req.body?.locale,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function verifyEmailChange(req, res, next) {
  try {
    const result = await emailChangeService.verifyEmailChange({
      userId: req.auth.userId,
      email: req.body?.email,
      code: req.body?.code,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requestEmailChange,
  verifyEmailChange,
};
