const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function generateFileName(originalName) {
  const ext = path.extname(originalName);
  return crypto.randomBytes(16).toString("hex") + ext;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function saveFileLocally(file, folderName = "misc") {
  const fileName = generateFileName(file.originalname);
  const uploadDir = path.join(__dirname, "..", "uploads", folderName);
  ensureDirectory(uploadDir);

  const absolutePath = path.join(uploadDir, fileName);
  fs.writeFileSync(absolutePath, file.buffer);

  return `/uploads/${folderName}/${fileName}`;
}

function hasS3Config() {
  return Boolean(process.env.AWS_BUCKET_NAME && process.env.AWS_REGION);
}

async function uploadToS3(file, options = {}) {
  if (!file) {
    return null;
  }

  const { folderName = "misc" } = options;

  if (!hasS3Config()) {
    return saveFileLocally(file, folderName);
  }

  const fileName = generateFileName(file.originalname);
  const keyPrefix = folderName ? `${String(folderName).replace(/^\/+|\/+$/g, "")}/` : "";
  const objectKey = `${keyPrefix}${fileName}`;
  const s3 = new S3Client({ region: process.env.AWS_REGION });

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: objectKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(params));
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${objectKey}`;
  } catch (error) {
    console.error("S3 upload failed, falling back to local storage:", error.message);
    return saveFileLocally(file, folderName);
  }
}

module.exports = { uploadToS3 };

