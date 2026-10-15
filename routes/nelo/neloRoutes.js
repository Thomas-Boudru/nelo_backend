const express = require("express");
const rateLimit = require("express-rate-limit");

const authenticate = require("../../middleware/authenticate");

const { sendMessage } = require("../../controllers/nelo/neloMessageController");

const { getRun } = require("../../controllers/nelo/neloRunController");

const {
  createConversation,
  listConversations,
  listMessages,
} = require("../../controllers/nelo/neloConversationController");

const router = express.Router();

const createConversationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: (req) => req.auth.userId,

  message: {
    error: {
      code: "TOO_MANY_CONVERSATIONS",
      message: "Please wait before creating another conversation.",
    },
  },
});

const sendMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: (req) => req.auth.userId,

  message: {
    error: {
      code: "TOO_MANY_CHAT_REQUESTS",
      message: "Please wait before sending another message.",
    },
  },
});

router.post(
  "/:childId/nelo/conversations",
  authenticate,
  createConversationLimiter,
  createConversation,
);

router.get("/:childId/nelo/conversations", authenticate, listConversations);

router.get(
  "/:childId/nelo/conversations/:conversationId/messages",
  authenticate,
  listMessages,
);

router.post(
  "/:childId/nelo/conversations/:conversationId/messages",
  authenticate,
  sendMessageLimiter,
  sendMessage,
);

router.get("/:childId/nelo/runs/:runId", authenticate, getRun);

module.exports = router;
