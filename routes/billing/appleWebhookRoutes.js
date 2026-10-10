const express = require("express");

const {
  receiveNotification,
} = require("../../controllers/billing/appleNotificationController");

const router = express.Router();

router.post("/subscriptions", receiveNotification);

module.exports = router;
