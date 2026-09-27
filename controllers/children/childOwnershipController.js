const childOwnershipService = require("../../services/children/childOwnershipService");

async function makeChildMemberOwner(req, res, next) {
  try {
    const member = await childOwnershipService.makeChildMemberOwner({
      childId: req.params.childId,
      childMemberId: req.params.childMemberId,
      actingUserId: req.auth.userId,
    });

    return res.status(200).json({ member });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  makeChildMemberOwner,
};
