const {
  upsertLeavePolicy,
  getLeavePoliciesByOrganization,
  updateLeavePolicy,
} = require("../services/leavePolicyService");

const ensureAdminAccess = (req, res) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (!role.includes("admin")) {
    res.status(403).json({
      statusCode: 403,
      message: "Forbidden: admin access required",
    });
    return false;
  }
  return true;
};

const createLeavePolicy = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  try {
    const organizationId = req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID missing in token",
      });
    }

    const policy = await upsertLeavePolicy(organizationId, req.body);
    return res.status(201).json({
      statusCode: 201,
      message: "Leave policy saved successfully",
      data: policy,
    });
  } catch (error) {
    const isValidation = /invalid|required|must/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to save leave policy",
      error: error.message,
    });
  }
};

const getLeavePolicies = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  try {
    const organizationId = req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID missing in token",
      });
    }

    const policies = await getLeavePoliciesByOrganization(organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Leave policies retrieved successfully",
      data: policies,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve leave policies",
      error: error.message,
    });
  }
};

const editLeavePolicy = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  try {
    const organizationId = req.user.organization_id;
    const policyId = Number(req.params.id);
    if (!organizationId || Number.isNaN(policyId)) {
      return res.status(400).json({
        statusCode: 400,
        message: "Valid organization and policy id are required",
      });
    }

    const policy = await updateLeavePolicy(organizationId, policyId, req.body);
    if (!policy) {
      return res.status(404).json({
        statusCode: 404,
        message: "Leave policy not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Leave policy updated successfully",
      data: policy,
    });
  } catch (error) {
    const isValidation = /invalid|required|must/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to update leave policy",
      error: error.message,
    });
  }
};

module.exports = {
  createLeavePolicy,
  getLeavePolicies,
  editLeavePolicy,
};
