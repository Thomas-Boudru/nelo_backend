const express = require("express");

const {
  receiveNotification,
} = require("../../controllers/billing/apple/appleNotificationController");

const router = express.Router();

router.post("/subscriptions", receiveNotification);

module.exports = router;
