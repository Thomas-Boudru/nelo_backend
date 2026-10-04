const express = require("express");

const noteController = require("../../../controllers/tracking/note/noteController");

const router = express.Router();

router.get("/:childId/notes/:entryId", noteController.getNoteEntry);

router.post("/:childId/notes", noteController.createNoteEntry);

router.patch("/:childId/notes/:entryId", noteController.updateNoteEntry);

module.exports = router;
