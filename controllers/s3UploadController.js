const multer = require("multer");
const { uploadToS3 } = require("../services/s3Uploader");

// Multer memory storage (keep file in memory before sending to S3)
const upload = multer({ storage: multer.memoryStorage() });

// File upload handler
exports.uploadAttachment = [
  upload.single("file"),
  async (req, res) => {
    try {

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Upload file to S3
      const s3Url = await uploadToS3(file);

      res.json({ success: true, url: s3Url });
    } catch (err) {
      console.error("Attachment upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
];