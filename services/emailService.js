const nodemailer = require('nodemailer');

// Create a reusable transporter using SMTP settings from environment variables
function createTransporter() {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP_HOST is not configured');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });
}

async function sendMail(options) {
  const transporter = createTransporter();
    const info = await transporter.sendMail(options);

 // return transporter.sendMail(options);
 console.log("📨 Email sent:", info.messageId);
  console.log("🔗 Preview URL:", nodemailer.getTestMessageUrl(info));

  return info;
}

function buildLeaveEmail({ adminEmail, organizationName, employeeName, leave }) {

   // Format date as DD-MM-YYYY
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const formattedStart = formatDate(leave.startDate);
  const formattedEnd = formatDate(leave.endDate);
  const subject = `[${organizationName || 'Attendix'}] New leave request from ${employeeName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>New Leave Request Submitted</h2>
      <p><strong>Employee:</strong> ${employeeName}</p>
      <p><strong>Type:</strong> ${leave.type}</p>
      <p><strong>Start Date:</strong> ${formattedStart}</p>
      <p><strong>End Date:</strong> ${formattedEnd}</p>
      ${leave.reason ? `<p><strong>Reason:</strong> ${leave.reason}</p>` : ''}
      <p style="margin-top:16px;">Please review and take action in the admin dashboard.</p>
    </div>
  `;
  return {
    to: adminEmail,
    subject,
    html
  };
}

async function sendNewLeaveRequestEmail({ adminEmail, organizationName, employeeName, leave }) {
  if (!adminEmail) {
    throw new Error('ADMIN_EMAIL is not configured');
  }
  const mail = buildLeaveEmail({ adminEmail, organizationName, employeeName, leave });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

module.exports = {
  sendNewLeaveRequestEmail
};



