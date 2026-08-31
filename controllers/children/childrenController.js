const childrenService = require("../../services/children/childrenService");

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

module.exports = {
  getAccessibleChildren,
};
