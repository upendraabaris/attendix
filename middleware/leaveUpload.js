const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadRoot = path.join(__dirname, "..", "uploads", "leave-proofs");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const leaveUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new Error("Only PDF, JPG, PNG, and WEBP files are allowed"));
      return;
    }

    cb(null, true);
  },
});

module.exports = {
  leaveUpload,
};
