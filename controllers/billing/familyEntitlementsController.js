const familyEntitlementsService = require("../../services/billing/familyEntitlementsService");

async function getFamilyEntitlements(req, res, next) {
  try {
    const entitlements = await familyEntitlementsService.getFamilyEntitlements({
      familyId: req.params.familyId,
      userId: req.auth.userId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      entitlements,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getFamilyEntitlements,
};
