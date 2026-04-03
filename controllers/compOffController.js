const {
  getWorkWeekPolicyByOrganization,
  upsertWorkWeekPolicy,
  updateWorkWeekPolicy,
  createHoliday,
  listHolidays,
  updateHoliday,
  deleteHoliday,
  earnCompOff,
  getCompOffBalance,
  getCompOffHistory,
  useCompOff,
} = require("../services/compOffService");

const hasAdminAccess = (req) => String(req.user?.role || "").toLowerCase().includes("admin");

const ensureOrganization = (req, res) => {
  const organizationId = req.user?.organization_id;
  if (!organizationId) {
    res.status(400).json({
      statusCode: 400,
      message: "Organization ID missing in token",
    });
    return null;
  }
  return organizationId;
};

const resolveEmployeeScope = (req, employeeIdFromParams) => {
  if (hasAdminAccess(req)) {
    return Number(employeeIdFromParams || req.body?.employee_id || req.user?.employee_id);
  }
  return Number(req.user?.employee_id);
};

const saveWorkWeekPolicy = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const policy = await upsertWorkWeekPolicy(organizationId, req.body);
    return res.status(201).json({
      statusCode: 201,
      message: "Work week policy saved successfully",
      data: policy,
    });
  } catch (error) {
    const isValidation = /invalid|required/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to save work week policy",
      error: error.message,
    });
  }
};

const fetchWorkWeekPolicy = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const policy = await getWorkWeekPolicyByOrganization(organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Work week policy retrieved successfully",
      data: policy,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve work week policy",
      error: error.message,
    });
  }
};

const editWorkWeekPolicy = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    if (!req.params.id) {
      const policy = await upsertWorkWeekPolicy(organizationId, req.body);
      return res.status(200).json({
        statusCode: 200,
        message: "Work week policy updated successfully",
        data: policy,
      });
    }

    const policyId = Number(req.params.id);
    if (Number.isNaN(policyId)) {
      return res.status(400).json({
        statusCode: 400,
        message: "Valid policy id is required",
      });
    }

    const policy = await updateWorkWeekPolicy(organizationId, policyId, req.body);
    if (!policy) {
      return res.status(404).json({
        statusCode: 404,
        message: "Work week policy not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Work week policy updated successfully",
      data: policy,
    });
  } catch (error) {
    const isValidation = /invalid|required/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to update work week policy",
      error: error.message,
    });
  }
};

const addHoliday = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const holiday = await createHoliday(organizationId, req.body);
    return res.status(201).json({
      statusCode: 201,
      message: "Holiday created successfully",
      data: holiday,
    });
  } catch (error) {
    const status = error.code === "23505" ? 409 : /invalid|required/i.test(error.message || "") ? 400 : 500;
    return res.status(status).json({
      statusCode: status,
      message:
        status === 409
          ? "Holiday already exists for the selected date"
          : error.message || "Failed to create holiday",
      error: error.message,
    });
  }
};

const getHolidays = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const holidays = await listHolidays(organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Holidays retrieved successfully",
      data: holidays,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve holidays",
      error: error.message,
    });
  }
};

const editHoliday = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const holidayId = Number(req.params.id);
  if (Number.isNaN(holidayId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid holiday id is required",
    });
  }

  try {
    const holiday = await updateHoliday(organizationId, holidayId, req.body);
    if (!holiday) {
      return res.status(404).json({
        statusCode: 404,
        message: "Holiday not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Holiday updated successfully",
      data: holiday,
    });
  } catch (error) {
    const status = error.code === "23505" ? 409 : /invalid|required/i.test(error.message || "") ? 400 : 500;
    return res.status(status).json({
      statusCode: status,
      message:
        status === 409
          ? "Holiday already exists for the selected date"
          : error.message || "Failed to update holiday",
      error: error.message,
    });
  }
};

const removeHoliday = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const holidayId = Number(req.params.id);
  if (Number.isNaN(holidayId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid holiday id is required",
    });
  }

  try {
    const deleted = await deleteHoliday(organizationId, holidayId);
    if (!deleted) {
      return res.status(404).json({
        statusCode: 404,
        message: "Holiday not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Holiday deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to delete holiday",
      error: error.message,
    });
  }
};

const earnCompOffForWorkDay = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const employeeId = resolveEmployeeScope(req, req.body?.employee_id);
  const workDate = req.body?.work_date || req.body?.workDate;

  if (!employeeId || Number.isNaN(employeeId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid employee_id is required",
    });
  }

  try {
    const result = await earnCompOff({
      employeeId,
      organizationId,
      workDate,
    });

    const statusCode = result.created ? 201 : result.duplicate ? 200 : 400;
    return res.status(statusCode).json({
      statusCode,
      message: result.message,
      data: result.data || null,
      meta: {
        eligible: result.eligible,
        duplicate: result.duplicate,
        reason: result.reason,
      },
    });
  } catch (error) {
    const isValidation = /required|valid|found|belong/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to earn comp off",
      error: error.message,
    });
  }
};

const fetchCompOffBalance = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const employeeId = resolveEmployeeScope(req, req.params.employee_id);
  if (!employeeId || Number.isNaN(employeeId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid employee_id is required",
    });
  }

  try {
    const balance = await getCompOffBalance(employeeId, organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Comp off balance retrieved successfully",
      data: balance,
    });
  } catch (error) {
    const isValidation = /found|belong/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to retrieve comp off balance",
      error: error.message,
    });
  }
};

const fetchCompOffHistory = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const employeeId = resolveEmployeeScope(req, req.params.employee_id);
  if (!employeeId || Number.isNaN(employeeId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid employee_id is required",
    });
  }

  try {
    const history = await getCompOffHistory(employeeId, organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Comp off history retrieved successfully",
      data: history,
    });
  } catch (error) {
    const isValidation = /found|belong/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to retrieve comp off history",
      error: error.message,
    });
  }
};

const markCompOffUsed = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const compOffId = Number(req.params.id);
  if (Number.isNaN(compOffId)) {
    return res.status(400).json({
      statusCode: 400,
      message: "Valid compensation leave id is required",
    });
  }

  const employeeId = hasAdminAccess(req) ? req.body?.employee_id || null : req.user?.employee_id;

  try {
    const updated = await useCompOff({
      compOffId,
      employeeId: employeeId ? Number(employeeId) : null,
      organizationId,
    });

    if (!updated) {
      return res.status(404).json({
        statusCode: 404,
        message: "Comp off entry not found or already used",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Comp off marked as used successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to mark comp off as used",
      error: error.message,
    });
  }
};

module.exports = {
  saveWorkWeekPolicy,
  fetchWorkWeekPolicy,
  editWorkWeekPolicy,
  addHoliday,
  getHolidays,
  editHoliday,
  removeHoliday,
  earnCompOffForWorkDay,
  fetchCompOffBalance,
  fetchCompOffHistory,
  markCompOffUsed,
};
