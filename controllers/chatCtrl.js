const { uploadToS3 } = require("../services/s3Uploader");
const {
  getChatContacts,
  listUserConversations,
  getConversationMessages,
  getOrCreateDirectConversation,
  createChatMessage,
  getConversationForUser,
  getConversationSummaryById,
  getEmployeeRoom,
  getConversationRoom,
} = require("../services/chatService");

const ensureChatUser = (req, res) => {
  if (!req.user?.employee_id || !req.user?.organization_id) {
    res.status(403).json({
      statusCode: 403,
      message: "Chat is available only for employees and organization admins",
    });
    return false;
  }

  return true;
};

const getChatContactsList = async (req, res) => {
  if (!ensureChatUser(req, res)) {
    return;
  }

  try {
    const contacts = await getChatContacts(
      req.user.organization_id,
      req.user.employee_id
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Chat contacts retrieved successfully",
      data: contacts,
    });
  } catch (error) {
    console.error("Error fetching chat contacts:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve chat contacts",
      error: error.message,
    });
  }
};

const getChatConversations = async (req, res) => {
  if (!ensureChatUser(req, res)) {
    return;
  }

  try {
    const conversations = await listUserConversations(
      req.user.organization_id,
      req.user.employee_id
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Chat conversations retrieved successfully",
      data: conversations,
    });
  } catch (error) {
    console.error("Error fetching chat conversations:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve chat conversations",
      error: error.message,
    });
  }
};

const createOrGetDirectConversation = async (req, res) => {
  if (!ensureChatUser(req, res)) {
    return;
  }

  try {
    const conversation = await getOrCreateDirectConversation({
      organizationId: req.user.organization_id,
      currentEmployeeId: req.user.employee_id,
      currentUserId: req.user.user_id,
      participantEmployeeId: req.body.participant_employee_id,
    });

    return res.status(201).json({
      statusCode: 201,
      message: "Chat conversation ready",
      data: conversation,
    });
  } catch (error) {
    const isValidation = /required|cannot|available/i.test(String(error.message || ""));

    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to create conversation",
      error: error.message,
    });
  }
};

const getMessagesByConversation = async (req, res) => {
  if (!ensureChatUser(req, res)) {
    return;
  }

  const conversationId = Number(req.params.conversationId);

  if (!conversationId) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid conversation id is required",
    });
  }

  try {
    const conversation = await getConversationForUser(
      conversationId,
      req.user.organization_id,
      req.user.employee_id
    );

    if (!conversation) {
      return res.status(404).json({
        statusCode: 404,
        message: "Conversation not found",
      });
    }

    const messages = await getConversationMessages(conversationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Chat messages retrieved successfully",
      data: messages,
    });
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve chat messages",
      error: error.message,
    });
  }
};

const sendMessageToConversation = async (req, res) => {
  if (!ensureChatUser(req, res)) {
    return;
  }

  const conversationId = Number(req.params.conversationId);

  if (!conversationId) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid conversation id is required",
    });
  }

  try {
    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = await uploadToS3(req.file, { folderName: "chat-attachments" });
    }

    const result = await createChatMessage({
      conversationId,
      organizationId: req.user.organization_id,
      senderUserId: req.user.user_id,
      senderEmployeeId: req.user.employee_id,
      message: req.body.message,
      file: req.file,
      attachmentUrl,
    });

    const conversation = await getConversationSummaryById(
      conversationId,
      req.user.employee_id
    );

    const io = req.app.get("io");
    const payload = {
      conversation,
      message: result.message,
    };

    io.to(getConversationRoom(conversationId)).emit("chat:message:new", payload);
    result.participantEmployeeIds.forEach((employeeId) => {
      io.to(getEmployeeRoom(employeeId)).emit("chat:conversation:updated", conversation);
    });

    return res.status(201).json({
      statusCode: 201,
      message: "Message sent successfully",
      data: payload,
    });
  } catch (error) {
    const isValidation = /required|not found/i.test(String(error.message || ""));

    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to send message",
      error: error.message,
    });
  }
};

module.exports = {
  getChatContactsList,
  getChatConversations,
  createOrGetDirectConversation,
  getMessagesByConversation,
  sendMessageToConversation,
};
