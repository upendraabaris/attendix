const {
  getAutoAbsentSetting,
  processAutoAbsentForOrganization,
  upsertAutoAbsentSetting,
} = require("../services/autoAbsentService");

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

const fetchAutoAbsentSetting = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const setting = await getAutoAbsentSetting(organizationId);
    return res.status(200).json({
      statusCode: 200,
      message: "Auto absent setting retrieved successfully",
      data: setting,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve auto absent setting",
      error: error.message,
    });
  }
};

const saveAutoAbsentSetting = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const setting = await upsertAutoAbsentSetting(organizationId, req.body);
    return res.status(200).json({
      statusCode: 200,
      message: "Auto absent setting saved successfully",
      data: setting,
    });
  } catch (error) {
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to save auto absent setting",
      error: error.message,
    });
  }
};

const runAutoAbsentForDate = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const workDate = req.body?.work_date || req.body?.workDate;
  if (!workDate) {
    return res.status(400).json({
      statusCode: 400,
      message: "work_date is required",
    });
  }

  try {
    const result = await processAutoAbsentForOrganization(organizationId, workDate);
    return res.status(200).json({
      statusCode: 200,
      message: "Auto absent processing completed",
      data: result,
    });
  } catch (error) {
    const isValidation = /valid|required/i.test(error.message || "");
    return res.status(isValidation ? 400 : 500).json({
      statusCode: isValidation ? 400 : 500,
      message: error.message || "Failed to process auto absent",
      error: error.message,
    });
  }
};

module.exports = {
  fetchAutoAbsentSetting,
  saveAutoAbsentSetting,
  runAutoAbsentForDate,
};
