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
        console.error("[socket] missing auth token", {
          origin: socket.handshake?.headers?.origin,
          address: socket.handshake?.address,
        });
        return next(new Error("Unauthorized"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.employee_id || !decoded?.organization_id) {
        console.error("[socket] invalid token payload", decoded);
        return next(new Error("Unauthorized"));
      }

      socket.user = decoded;
      return next();
    } catch (error) {
      console.error("[socket] authentication failed", {
        message: error.message,
        origin: socket.handshake?.headers?.origin,
      });
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const { employee_id: employeeId, organization_id: organizationId } = socket.user;
    socket.join(getEmployeeRoom(employeeId));

    console.log("[socket] connected", {
      socketId: socket.id,
      employeeId,
      organizationId,
      transport: socket.conn?.transport?.name,
      origin: socket.handshake?.headers?.origin,
    });

    try {
      const conversationIds = await getConversationIdsForEmployee(organizationId, employeeId);
      conversationIds.forEach((conversationId) => {
        socket.join(getConversationRoom(conversationId));
      });

      console.log("[socket] hydrated conversation rooms", {
        socketId: socket.id,
        employeeId,
        rooms: conversationIds,
      });
    } catch (error) {
      console.error("Failed to hydrate socket chat rooms:", error.message);
    }

    socket.on("chat:join", async (payload = {}) => {
      const conversationId = Number(payload.conversationId);
      if (!conversationId) {
        console.warn("[socket] chat:join skipped because conversationId is invalid", payload);
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
          console.log("[socket] joined conversation room", {
            socketId: socket.id,
            employeeId,
            conversationId,
          });
        } else {
          console.warn("[socket] chat:join denied", {
            socketId: socket.id,
            employeeId,
            conversationId,
          });
        }
      } catch (error) {
        console.error("Failed to join chat room:", error.message);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("[socket] disconnected", {
        socketId: socket.id,
        employeeId,
        reason,
      });
    });
  });
};

module.exports = {
  attachChatSocket,
};
