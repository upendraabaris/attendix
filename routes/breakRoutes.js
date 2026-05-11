const {
    startBreak,
    endBreak
} = require("../controllers/breakControllers");


const authenticate =
    require("../middleware/authMiddleware");


router.post("/start", authenticate, startBreak);

router.post("/end", authenticate, endBreak);


module.exports = router;