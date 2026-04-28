const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/s3UploadController');

router.post('/upload', uploadController.uploadAttachment);

module.exports = router;
