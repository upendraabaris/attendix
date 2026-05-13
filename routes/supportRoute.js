const router = require("express").Router();
const {
  createSupportTicket,
  getSupportTickets,
  getSupportTicketComments,
  addSupportTicketComment,
  updateSupportTicketStatus,
} = require("../controllers/supportCtrl");
const { authenticate } = require("../middleware/authMiddleware");
const { supportUpload } = require("../middleware/supportUpload");

router.post("/", authenticate, supportUpload.single("attachment"), createSupportTicket);
router.get("/", authenticate, getSupportTickets);
router.get("/:ticketId/comments", authenticate, getSupportTicketComments);
router.post("/:ticketId/comments", authenticate, addSupportTicketComment);
router.put("/:ticketId/status", authenticate, updateSupportTicketStatus);

module.exports = router;
