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

function buildLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status }) {
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
  const statusText = status === 'approved' ? 'Approved' : 'Rejected';
  const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
  
  const subject = `[${organizationName || 'Attendix'}] Your leave request has been ${statusText}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="color: ${statusColor};">Leave Request ${statusText}</h2>
      <p>Dear ${employeeName},</p>
      <p>Your leave request has been <strong style="color: ${statusColor};">${statusText.toLowerCase()}</strong>.</p>
      
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <h3>Leave Request Details:</h3>
        <p><strong>Type:</strong> ${leave.type}</p>
        <p><strong>Start Date:</strong> ${formattedStart}</p>
        <p><strong>End Date:</strong> ${formattedEnd}</p>
        ${leave.reason ? `<p><strong>Reason:</strong> ${leave.reason}</p>` : ''}
      </div>
      
      ${status === 'approved' 
        ? '<p style="color: #28a745;">Your leave has been approved. Please plan accordingly.</p>'
        : '<p style="color: #dc3545;">Unfortunately, your leave request could not be approved at this time. Please contact your supervisor for more information.</p>'
      }
      
      <p style="margin-top: 20px;">Thank you for using ${organizationName || 'Attendix'}.</p>
    </div>
  `;
  
  return {
    to: employeeEmail,
    subject,
    html
  };
}

async function sendLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status }) {
  if (!employeeEmail) {
    throw new Error('Employee email is required');
  }
  const mail = buildLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

module.exports = {
  sendNewLeaveRequestEmail,
  sendLeaveStatusEmail
};



