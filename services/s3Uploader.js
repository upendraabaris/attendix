const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const path = require("path");

const s3 = new S3Client({ region: process.env.AWS_REGION });

function generateFileName(originalName) {
  const ext = path.extname(originalName);
  return crypto.randomBytes(16).toString("hex") + ext;
}

async function uploadToS3(file) {
  const fileName = generateFileName(file.originalname);

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  await s3.send(new PutObjectCommand(params));

  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
}

module.exports = { uploadToS3 };

