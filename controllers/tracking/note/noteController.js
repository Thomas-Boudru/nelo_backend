const noteService = require("../../../services/tracking/note/noteService");

async function getNoteEntry(req, res, next) {
  try {
    const entry = await noteService.getNoteEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

async function createNoteEntry(req, res, next) {
  try {
    const result = await noteService.createNoteEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateNoteEntry(req, res, next) {
  try {
    const entry = await noteService.updateNoteEntry({
      childId: req.params.childId,
      userId: req.auth.userId,
      entryId: req.params.entryId,
      data: req.body,
    });

    return res.status(200).json({ entry });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getNoteEntry,
  createNoteEntry,
  updateNoteEntry,
};
