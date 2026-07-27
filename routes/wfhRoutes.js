const router = require("express").Router();
const {
    createWFHRequest,
    getMyWFHRequests,
    getAllWFHRequests,
    getPendingWFHRequests,
    updateWFHRequestStatus,
} = require("../controllers/wfhCtrl");

const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

/**
 * @route POST /api/wfh
 * @desc Submit a new WFH request
 * @access Private (Employee)
 */
router.post("/", authenticate, createWFHRequest);

/**
 * @route GET /api/wfh/my
 * @desc Get WFH requests for logged-in employee
 * @access Private (Employee)
 */
router.get("/my", authenticate, getMyWFHRequests);

/**
 * @route GET /api/wfh/get
 * @desc Get all WFH requests for the org
 * @access Private (Admin)
 */
router.get("/get", authenticate, authorizeRoles("admin"), getAllWFHRequests);

/**
 * @route GET /api/wfh/admin/wfh-requests/pending
 * @desc Get only pending WFH requests
 * @access Private (Admin)
 */
router.get("/admin/wfh-requests/pending", authenticate, authorizeRoles("admin"), getPendingWFHRequests);

/**
 * @route PUT /api/wfh/update/:wfhId
 * @desc Update WFH request status (approve/reject)
 * @access Private (Admin)
 */
router.put("/update/:wfhId", authenticate, authorizeRoles("admin"), updateWFHRequestStatus);

module.exports = router;