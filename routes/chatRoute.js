const router = require("express").Router();
const { authenticate } = require("../middleware/authMiddleware");
const { chatUpload } = require("../middleware/chatUpload");
const {
  getChatContactsList,
  getChatConversations,
  createOrGetDirectConversation,
  getMessagesByConversation,
  sendMessageToConversation,
} = require("../controllers/chatCtrl");

router.get("/contacts", authenticate, getChatContactsList);
router.get("/conversations", authenticate, getChatConversations);
router.post("/conversations", authenticate, createOrGetDirectConversation);
router.get("/conversations/:conversationId/messages", authenticate, getMessagesByConversation);
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  chatUpload.single("attachment"),
  sendMessageToConversation
);

module.exports = router;
