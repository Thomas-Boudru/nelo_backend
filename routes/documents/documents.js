const express = require("express");
const upload = require("../middleware/uploadMiddleware");
const {
  uploadAndAnalyzeDocument,
} = require("../controllers/documentController");

const router = express.Router();

router.post("/analyze", upload.single("document"), uploadAndAnalyzeDocument);

module.exports = router;
