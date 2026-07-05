const { v4: uuidv4 } = require("uuid");
const { uploadToR2 } = require("../services/r2Service");
const { analyzeDocumentImage } = require("../services/openaiService");

async function uploadAndAnalyzeDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Image manquante.",
      });
    }

    const extension = req.file.mimetype.split("/")[1];
    const key = `documents/${uuidv4()}.${extension}`;

    const uploadedFile = await uploadToR2({
      buffer: req.file.buffer,
      key,
      contentType: req.file.mimetype,
    });

    const extractedData = await analyzeDocumentImage({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    return res.status(200).json({
      file: uploadedFile,
      extractedData,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { uploadAndAnalyzeDocument };
