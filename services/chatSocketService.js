const jwt = require("jsonwebtoken");
const {
  canAccessConversation,
  getConversationIdsForEmployee,
  getConversationRoom,
  getEmployeeRoom,
} = require("./chatService");

const extractToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) {
    return String(authToken).replace(/^Bearer\s+/i, "").trim();
  }

  const headerToken = socket.handshake?.headers?.authorization;
  if (headerToken) {
    return String(headerToken).replace(/^Bearer\s+/i, "").trim();
  }

  return "";
};

const attachChatSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.employee_id || !decoded?.organization_id) {
        return next(new Error("Unauthorized"));
      }

      socket.user = decoded;
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const { employee_id: employeeId, organization_id: organizationId } = socket.user;
    socket.join(getEmployeeRoom(employeeId));

    try {
      const conversationIds = await getConversationIdsForEmployee(organizationId, employeeId);
      conversationIds.forEach((conversationId) => {
        socket.join(getConversationRoom(conversationId));
      });
    } catch (error) {
      console.error("Failed to hydrate socket chat rooms:", error.message);
    }

    socket.on("chat:join", async (payload = {}) => {
      const conversationId = Number(payload.conversationId);
      if (!conversationId) {
        return;
      }

      try {
        const allowed = await canAccessConversation(
          conversationId,
          organizationId,
          employeeId
        );

        if (allowed) {
          socket.join(getConversationRoom(conversationId));
        }
      } catch (error) {
        console.error("Failed to join chat room:", error.message);
      }
    });

    socket.on("disconnect", () => {
      console.log("Chat socket disconnected:", socket.id);
    });
  });
};

module.exports = {
  attachChatSocket,
};
