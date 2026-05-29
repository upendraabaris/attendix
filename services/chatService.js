const pool = require("../configure/dbConfig");

const DIRECT_CHAT_TYPE = "direct";

const buildAttachmentUrl = (attachmentPath) => {
  if (!attachmentPath) {
    return null;
  }

  return attachmentPath;
};

const serializeMessage = (message) => ({
  ...message,
  attachment_url: buildAttachmentUrl(message.attachment_url),
});

const serializeConversation = (conversation) => ({
  ...conversation,
  unread_count: Number(conversation.unread_count || 0),
  has_unread: Number(conversation.unread_count || 0) > 0,
  last_message_attachment_url: buildAttachmentUrl(
    conversation.last_message_attachment_url
  ),
});

const getEmployeeRoom = (employeeId) => `employee:${employeeId}`;
const getConversationRoom = (conversationId) => `conversation:${conversationId}`;

const getChatContacts = async (organizationId, currentEmployeeId) => {
  const result = await pool.query(
    `
      SELECT
        e.id AS employee_id,
        e.name,
        e.email,
        e.phone,
        LOWER(e.role) AS role,
        COALESCE(e.status, 'active') AS status
      FROM employees e
      WHERE e.organization_id = $1
        AND e.id <> $2
        AND COALESCE(e.status, 'active') = 'active'
      ORDER BY
        CASE WHEN LOWER(e.role) = 'admin' THEN 0 ELSE 1 END,
        e.name ASC
    `,
    [organizationId, currentEmployeeId]
  );

  return result.rows;
};

const assertParticipantsBelongToOrganization = async (
  organizationId,
  employeeIds
) => {
  const result = await pool.query(
    `
      SELECT id
      FROM employees
      WHERE organization_id = $1
        AND id = ANY($2::int[])
        AND COALESCE(status, 'active') = 'active'
    `,
    [organizationId, employeeIds]
  );

  if (result.rows.length !== employeeIds.length) {
    throw new Error("Selected employee is not available for chat");
  }
};

const getExistingDirectConversation = async (
  organizationId,
  participantEmployeeIds
) => {
  const result = await pool.query(
    `
      SELECT c.*
      FROM chat_conversations c
      JOIN chat_conversation_participants cp
        ON cp.conversation_id = c.id
      WHERE c.organization_id = $1
        AND c.type = $2
      GROUP BY c.id
      HAVING COUNT(*) = 2
         AND COUNT(*) FILTER (WHERE cp.employee_id = ANY($3::int[])) = 2
      LIMIT 1
    `,
    [organizationId, DIRECT_CHAT_TYPE, participantEmployeeIds]
  );

  return result.rows[0] || null;
};

const getConversationIdsForEmployee = async (organizationId, employeeId) => {
  const result = await pool.query(
    `
      SELECT cp.conversation_id
      FROM chat_conversation_participants cp
      JOIN chat_conversations c ON c.id = cp.conversation_id
      WHERE cp.employee_id = $1
        AND c.organization_id = $2
    `,
    [employeeId, organizationId]
  );

  return result.rows.map((row) => Number(row.conversation_id));
};

const getConversationForUser = async (
  conversationId,
  organizationId,
  employeeId
) => {
  const result = await pool.query(
    `
      SELECT c.*
      FROM chat_conversations c
      JOIN chat_conversation_participants cp
        ON cp.conversation_id = c.id
      WHERE c.id = $1
        AND c.organization_id = $2
        AND cp.employee_id = $3
      LIMIT 1
    `,
    [conversationId, organizationId, employeeId]
  );

  return result.rows[0] || null;
};

const conversationSummarySelect = `
  SELECT
    c.id,
    c.organization_id,
    c.type,
    c.created_at,
    c.updated_at,
    c.last_message_at,
    cp.last_read_message_id,
    cp.last_read_at,
    other.employee_id AS other_employee_id,
    other.name AS other_employee_name,
    other.email AS other_employee_email,
    other.role AS other_employee_role,
    lm.id AS last_message_id,
    lm.message AS last_message_text,
    lm.attachment_url AS last_message_attachment_url,
    lm.attachment_name AS last_message_attachment_name,
    lm.created_at AS last_message_created_at,
    lm.sender_employee_id AS last_message_sender_employee_id,
    lm.sender_name AS last_message_sender_name,
    COALESCE(unread.unread_count, 0)::int AS unread_count
  FROM chat_conversations c
  JOIN chat_conversation_participants cp
    ON cp.conversation_id = c.id
   AND cp.employee_id = $2
  LEFT JOIN LATERAL (
    SELECT
      cp2.employee_id,
      e.name,
      e.email,
      LOWER(e.role) AS role
    FROM chat_conversation_participants cp2
    JOIN employees e ON e.id = cp2.employee_id
    WHERE cp2.conversation_id = c.id
      AND cp2.employee_id <> $2
    ORDER BY cp2.id ASC
    LIMIT 1
  ) other ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      m.id,
      m.message,
      m.attachment_url,
      m.attachment_name,
      m.created_at,
      m.sender_employee_id,
      e.name AS sender_name
    FROM chat_messages m
    JOIN employees e ON e.id = m.sender_employee_id
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS unread_count
    FROM chat_messages m
    WHERE m.conversation_id = c.id
      AND m.sender_employee_id <> $2
      AND (
        cp.last_read_message_id IS NULL
        OR m.id > cp.last_read_message_id
      )
  ) unread ON TRUE
`;

const getConversationSummaryById = async (conversationId, currentEmployeeId) => {
  const result = await pool.query(
    `
      ${conversationSummarySelect}
      WHERE c.id = $1
      LIMIT 1
    `,
    [conversationId, currentEmployeeId]
  );

  return result.rows[0] ? serializeConversation(result.rows[0]) : null;
};

const listUserConversations = async (organizationId, employeeId) => {
  const result = await pool.query(
    `
      ${conversationSummarySelect}
      WHERE c.organization_id = $1
      ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC, c.id DESC
    `,
    [organizationId, employeeId]
  );

  return result.rows.map(serializeConversation);
};

const getConversationMessages = async (conversationId) => {
  const result = await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_user_id,
        m.sender_employee_id,
        e.name AS sender_name,
        LOWER(e.role) AS sender_role,
        m.message,
        m.attachment_url,
        m.attachment_name,
        m.attachment_mime_type,
        m.created_at,
        m.updated_at
      FROM chat_messages m
      JOIN employees e ON e.id = m.sender_employee_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC, m.id ASC
    `,
    [conversationId]
  );

  return result.rows.map(serializeMessage);
};

const getOrCreateDirectConversation = async ({
  organizationId,
  currentEmployeeId,
  currentUserId,
  participantEmployeeId,
}) => {
  const normalizedParticipantId = Number(participantEmployeeId);

  if (!normalizedParticipantId) {
    throw new Error("Valid participant_employee_id is required");
  }

  if (normalizedParticipantId === Number(currentEmployeeId)) {
    throw new Error("You cannot start a chat with yourself");
  }

  const participantIds = [Number(currentEmployeeId), normalizedParticipantId].sort(
    (a, b) => a - b
  );
  await assertParticipantsBelongToOrganization(organizationId, participantIds);

  const existingConversation = await getExistingDirectConversation(
    organizationId,
    participantIds
  );
  if (existingConversation) {
    return getConversationSummaryById(existingConversation.id, currentEmployeeId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const conversationResult = await client.query(
      `
        INSERT INTO chat_conversations (
          organization_id,
          type,
          created_by_user_id,
          updated_at
        )
        VALUES ($1, $2, $3, NOW())
        RETURNING *
      `,
      [organizationId, DIRECT_CHAT_TYPE, currentUserId || null]
    );

    const conversationId = conversationResult.rows[0].id;

    await client.query(
      `
        INSERT INTO chat_conversation_participants (
          conversation_id,
          employee_id,
          last_read_at
        )
        VALUES
          ($1, $2, NOW()),
          ($1, $3, NULL)
      `,
      [conversationId, participantIds[0], participantIds[1]]
    );

    await client.query("COMMIT");
    return getConversationSummaryById(conversationId, currentEmployeeId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const markConversationAsRead = async ({
  conversationId,
  organizationId,
  employeeId,
}) => {
  const conversation = await getConversationForUser(
    conversationId,
    organizationId,
    employeeId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const latestMessageResult = await pool.query(
    `
      SELECT id
      FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [conversationId]
  );

  const latestMessageId = Number(latestMessageResult.rows[0]?.id || 0) || null;

  await pool.query(
    `
      UPDATE chat_conversation_participants
      SET
        last_read_message_id = $1,
        last_read_at = NOW()
      WHERE conversation_id = $2
        AND employee_id = $3
    `,
    [latestMessageId, conversationId, employeeId]
  );

  return getConversationSummaryById(conversationId, employeeId);
};

const createChatMessage = async ({
  conversationId,
  organizationId,
  senderUserId,
  senderEmployeeId,
  message,
  file,
  attachmentUrl,
}) => {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage && !attachmentUrl) {
    throw new Error("Message text or attachment is required");
  }

  const conversation = await getConversationForUser(
    conversationId,
    organizationId,
    senderEmployeeId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `
        INSERT INTO chat_messages (
          conversation_id,
          sender_user_id,
          sender_employee_id,
          message,
          attachment_url,
          attachment_name,
          attachment_mime_type,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `,
      [
        conversationId,
        senderUserId || null,
        senderEmployeeId,
        trimmedMessage || null,
        attachmentUrl || null,
        file?.originalname || null,
        file?.mimetype || null,
      ]
    );

    const insertedMessageId = Number(inserted.rows[0].id);

    await client.query(
      `
        UPDATE chat_conversations
        SET updated_at = NOW(),
            last_message_at = NOW()
        WHERE id = $1
      `,
      [conversationId]
    );

    await client.query(
      `
        UPDATE chat_conversation_participants
        SET
          last_read_message_id = CASE
            WHEN employee_id = $2 THEN $3
            ELSE last_read_message_id
          END,
          last_read_at = CASE
            WHEN employee_id = $2 THEN NOW()
            ELSE last_read_at
          END
        WHERE conversation_id = $1
      `,
      [conversationId, senderEmployeeId, insertedMessageId]
    );

    const participantsResult = await client.query(
      `
        SELECT employee_id
        FROM chat_conversation_participants
        WHERE conversation_id = $1
      `,
      [conversationId]
    );

    const messageResult = await client.query(
      `
        SELECT
          m.id,
          m.conversation_id,
          m.sender_user_id,
          m.sender_employee_id,
          e.name AS sender_name,
          LOWER(e.role) AS sender_role,
          m.message,
          m.attachment_url,
          m.attachment_name,
          m.attachment_mime_type,
          m.created_at,
          m.updated_at
        FROM chat_messages m
        JOIN employees e ON e.id = m.sender_employee_id
        WHERE m.id = $1
        LIMIT 1
      `,
      [insertedMessageId]
    );

    await client.query("COMMIT");

    return {
      message: serializeMessage(messageResult.rows[0]),
      participantEmployeeIds: participantsResult.rows.map((row) =>
        Number(row.employee_id)
      ),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const canAccessConversation = async (
  conversationId,
  organizationId,
  employeeId
) => {
  const conversation = await getConversationForUser(
    conversationId,
    organizationId,
    employeeId
  );
  return Boolean(conversation);
};

module.exports = {
  DIRECT_CHAT_TYPE,
  getEmployeeRoom,
  getConversationRoom,
  getChatContacts,
  getConversationIdsForEmployee,
  getConversationForUser,
  listUserConversations,
  getConversationMessages,
  getOrCreateDirectConversation,
  markConversationAsRead,
  createChatMessage,
  getConversationSummaryById,
  canAccessConversation,
};
