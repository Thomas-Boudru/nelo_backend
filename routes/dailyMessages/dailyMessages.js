const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getToday,
  getHistory,
  getById,
  getCatalog,
} = require("../../controllers/dailyMessages/dailyMessagesController");

const router = express.Router({
  mergeParams: true,
});

router.use(authenticate);

router.get("/today", getToday);
router.get("/history", getHistory);
router.get("/catalog", getCatalog);
router.get("/:messageId", getById);

module.exports = router;
