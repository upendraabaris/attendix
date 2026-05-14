const pool = require("../configure/dbConfig");
const { uploadToS3 } = require("../services/s3Uploader");

const buildAttachmentUrl = (attachmentPath) => {
  if (!attachmentPath) {
    return null;
  }

  if (attachmentPath.startsWith("http")) {
    return attachmentPath;
  }

  return attachmentPath;
};

const normalizeRole = (role) => String(role || "").toLowerCase();
const isGlobalSupportRole = (role) => normalizeRole(role) === "support";
const isOrganizationAdminRole = (role) => normalizeRole(role) === "admin";

const canAccessTicket = (ticket, user) => {
  const role = normalizeRole(user.role);

  if (isGlobalSupportRole(role)) {
    return true;
  }

  if (isOrganizationAdminRole(role)) {
    return Number(ticket.organization_id) === Number(user.organization_id);
  }

  return Number(ticket.employee_id) === Number(user.employee_id);
};

const serializeTicket = (ticket) => ({
  ...ticket,
  attachment_url: buildAttachmentUrl(ticket.attachment_url),
});

const getTicketById = async (ticketId) => {
  const result = await pool.query(
    `
      SELECT
        st.id,
        st.organization_id,
        st.employee_id,
        st.created_by_user_id,
        st.created_by_role,
        st.title,
        st.description,
        st.status,
        st.attachment_url,
        st.created_at,
        st.updated_at,
        o.name AS organization_name,
        e.name AS employee_name,
        e.email AS employee_email
      FROM support_tickets st
      JOIN organizations o ON o.id = st.organization_id
      JOIN employees e ON e.id = st.employee_id
      WHERE st.id = $1
      LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0] || null;
};

const createSupportTicket = async (req, res) => {
  const { title, description } = req.body;
  const { employee_id: employeeId, organization_id: organizationId, user_id: userId, role } = req.user;

  if (isGlobalSupportRole(role)) {
    return res.status(403).json({
      statusCode: 403,
      message: "Support users cannot create support tickets",
    });
  }

  if (!title || !description) {
    return res.status(400).json({
      statusCode: 400,
      message: "Title and description are required",
    });
  }

  try {
    let attachmentUrl = null;

    if (req.file) {
      attachmentUrl = await uploadToS3(req.file, { folderName: "support-attachments" });
    }

    const result = await pool.query(
      `
        INSERT INTO support_tickets (
          organization_id,
          employee_id,
          created_by_user_id,
          created_by_role,
          title,
          description,
          attachment_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        organizationId,
        employeeId,
        userId,
        normalizeRole(role),
        title.trim(),
        description.trim(),
        attachmentUrl,
      ]
    );

    const ticket = await getTicketById(result.rows[0].id);

    return res.status(201).json({
      statusCode: 201,
      message: "Support ticket created successfully",
      data: serializeTicket(ticket),
    });
  } catch (error) {
    console.error("Error creating support ticket:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to create support ticket",
      error: error.message,
    });
  }
};

const getSupportTickets = async (req, res) => {
  const { organization_id: organizationId, employee_id: employeeId, role } = req.user;
  const normalizedRole = normalizeRole(role);
  const status = req.query.status ? String(req.query.status).toLowerCase() : "";

  try {
    const params = [];
    const conditions = [];

    if (!isGlobalSupportRole(normalizedRole)) {
      params.push(organizationId);
      conditions.push(`st.organization_id = $${params.length}`);
    }

    if (!isOrganizationAdminRole(normalizedRole) && !isGlobalSupportRole(normalizedRole)) {
      params.push(employeeId);
      conditions.push(`st.employee_id = $${params.length}`);
    }

    if (status && status !== "all") {
      params.push(status);
      conditions.push(`LOWER(st.status) = $${params.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          st.id,
          st.organization_id,
          st.employee_id,
          st.created_by_user_id,
          st.created_by_role,
          st.title,
          st.description,
          st.status,
          st.attachment_url,
          st.created_at,
          st.updated_at,
          o.name AS organization_name,
          e.name AS employee_name,
          e.email AS employee_email
        FROM support_tickets st
        JOIN organizations o ON o.id = st.organization_id
        JOIN employees e ON e.id = st.employee_id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY st.created_at DESC
      `,
      params
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Support tickets retrieved successfully",
      data: result.rows.map(serializeTicket),
    });
  } catch (error) {
    console.error("Error fetching support tickets:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve support tickets",
      error: error.message,
    });
  }
};

const getSupportTicketComments = async (req, res) => {
  const ticketId = Number(req.params.ticketId);

  if (!ticketId) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid ticket id is required",
    });
  }

  try {
    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        statusCode: 404,
        message: "Support ticket not found",
      });
    }

    if (!canAccessTicket(ticket, req.user)) {
      return res.status(403).json({
        statusCode: 403,
        message: "You do not have access to this ticket",
      });
    }

    const result = await pool.query(
      `
        SELECT
          sc.id,
          sc.ticket_id,
          sc.comment,
          sc.commented_by_user_id,
          sc.commented_by_employee_id,
          sc.commented_by_support_user_id,
          sc.commented_by_role,
          sc.created_at,
          COALESCE(e.name, su.name) AS commented_by_name
        FROM support_comments sc
        LEFT JOIN employees e ON e.id = sc.commented_by_employee_id
        LEFT JOIN support_users su ON su.id = sc.commented_by_support_user_id
        WHERE sc.ticket_id = $1
        ORDER BY sc.created_at ASC
      `,
      [ticketId]
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Support comments retrieved successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching support comments:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve support comments",
      error: error.message,
    });
  }
};

const addSupportTicketComment = async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const comment = String(req.body.comment || "").trim();
  const { user_id: userId, employee_id: employeeId, support_user_id: supportUserId, role } = req.user;

  if (!ticketId) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid ticket id is required",
    });
  }

  if (!comment) {
    return res.status(400).json({
      statusCode: 400,
      message: "Comment is required",
    });
  }

  try {
    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        statusCode: 404,
        message: "Support ticket not found",
      });
    }

    if (!canAccessTicket(ticket, req.user)) {
      return res.status(403).json({
        statusCode: 403,
        message: "You do not have access to this ticket",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO support_comments (
          ticket_id,
          comment,
          commented_by_user_id,
          commented_by_employee_id,
          commented_by_support_user_id,
          commented_by_role
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [ticketId, comment, userId || null, employeeId || null, supportUserId || null, normalizeRole(role)]
    );

    await pool.query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`,
      [ticketId]
    );

    return res.status(201).json({
      statusCode: 201,
      message: "Comment added successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error adding support comment:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to add comment",
      error: error.message,
    });
  }
};

const updateSupportTicketStatus = async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const status = String(req.body.status || "").trim().toLowerCase();
  const allowedStatuses = new Set(["open", "in_progress", "resolved", "closed"]);
  const role = normalizeRole(req.user.role);

  if (!isOrganizationAdminRole(role) && !isGlobalSupportRole(role)) {
    return res.status(403).json({
      statusCode: 403,
      message: "Only admin or support users can update ticket status",
    });
  }

  if (!ticketId || !allowedStatuses.has(status)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid ticket id and status are required",
    });
  }

  try {
    const query = isGlobalSupportRole(role)
      ? `
        UPDATE support_tickets
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `
      : `
        UPDATE support_tickets
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3
        RETURNING *
      `;

    const params = isGlobalSupportRole(role)
      ? [status, ticketId]
      : [status, ticketId, req.user.organization_id];

    const result = await pool.query(query, params);

    if (!result.rows.length) {
      return res.status(404).json({
        statusCode: 404,
        message: "Support ticket not found",
      });
    }

    const ticket = await getTicketById(ticketId);

    return res.status(200).json({
      statusCode: 200,
      message: "Support ticket status updated successfully",
      data: serializeTicket(ticket),
    });
  } catch (error) {
    console.error("Error updating support ticket status:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to update support ticket status",
      error: error.message,
    });
  }
};

module.exports = {
  createSupportTicket,
  getSupportTickets,
  getSupportTicketComments,
  addSupportTicketComment,
  updateSupportTicketStatus,
};
