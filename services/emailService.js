// const nodemailer = require('nodemailer');

// // Create a reusable transporter using SMTP settings from environment variables
// function createTransporter() {
//   if (!process.env.SMTP_HOST) {
//     throw new Error('SMTP_HOST is not configured');
//   }
//   return nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: parseInt(process.env.SMTP_PORT || '587', 10),
//     secure: process.env.SMTP_SECURE === 'true',
//     auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
//       user: process.env.SMTP_USER,
//       pass: process.env.SMTP_PASS
//     } : undefined
//   });
// }

// async function sendMail(options) {
//   const transporter = createTransporter();
//   const info = await transporter.sendMail(options);

//   // return transporter.sendMail(options);
//   console.log("📨 Email sent:", info.messageId);
//   console.log("🔗 Preview URL:", nodemailer.getTestMessageUrl(info));

//   return info;
// }

// function buildLeaveEmail({ adminEmail, organizationName, employeeName, leave }) {

//   // Format date as DD-MM-YYYY
//   const formatDate = (dateStr) => {
//     if (!dateStr) return "";
//     const d = new Date(dateStr);
//     const day = String(d.getDate()).padStart(2, "0");
//     const month = String(d.getMonth() + 1).padStart(2, "0");
//     const year = d.getFullYear();
//     return `${day}-${month}-${year}`;
//   };

//   const formattedStart = formatDate(leave.startDate);
//   const formattedEnd = formatDate(leave.endDate);
//   const subject = `[${organizationName || 'Attendix'}] New leave request from ${employeeName}`;
//   const html = `
//     <div style="font-family: Arial, sans-serif; line-height: 1.5;">
//       <h2>New Leave Request Submitted</h2>
//       <p><strong>Employee:</strong> ${employeeName}</p>
//       <p><strong>Type:</strong> ${leave.type}</p>
//       <p><strong>Start Date:</strong> ${formattedStart}</p>
//       <p><strong>End Date:</strong> ${formattedEnd}</p>
//       ${leave.reason ? `<p><strong>Reason:</strong> ${leave.reason}</p>` : ''}
//       <p style="margin-top:16px;">Please review and take action in the admin dashboard.</p>
//     </div>
//   `;
//   return {
//     to: adminEmail,
//     subject,
//     html
//   };
// }

// async function sendNewLeaveRequestEmail({ adminEmail, organizationName, employeeName, leave }) {
//   if (!adminEmail) {
//     throw new Error('ADMIN_EMAIL is not configured');
//   }
//   const mail = buildLeaveEmail({ adminEmail, organizationName, employeeName, leave });
//   const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
//   return sendMail({ from, ...mail });
// }

// function buildLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status }) {
//   // Format date as DD-MM-YYYY
//   const formatDate = (dateStr) => {
//     if (!dateStr) return "";
//     const d = new Date(dateStr);
//     const day = String(d.getDate()).padStart(2, "0");
//     const month = String(d.getMonth() + 1).padStart(2, "0");
//     const year = d.getFullYear();
//     return `${day}-${month}-${year}`;
//   };

//   const formattedStart = formatDate(leave.startDate);
//   const formattedEnd = formatDate(leave.endDate);
//   const statusText = status === 'approved' ? 'Approved' : 'Rejected';
//   const statusColor = status === 'approved' ? '#28a745' : '#dc3545';

//   const subject = `[${organizationName || 'Attendix'}] Your leave request has been ${statusText}`;
//   const html = `
//     <div style="font-family: Arial, sans-serif; line-height: 1.5;">
//       <h2 style="color: ${statusColor};">Leave Request ${statusText}</h2>
//       <p>Dear ${employeeName},</p>
//       <p>Your leave request has been <strong style="color: ${statusColor};">${statusText.toLowerCase()}</strong>.</p>

//       <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
//         <h3>Leave Request Details:</h3>
//         <p><strong>Type:</strong> ${leave.type}</p>
//         <p><strong>Start Date:</strong> ${formattedStart}</p>
//         <p><strong>End Date:</strong> ${formattedEnd}</p>
//         ${leave.reason ? `<p><strong>Reason:</strong> ${leave.reason}</p>` : ''}
//       </div>

//       ${status === 'approved'
//       ? '<p style="color: #28a745;">Your leave has been approved. Please plan accordingly.</p>'
//       : '<p style="color: #dc3545;">Unfortunately, your leave request could not be approved at this time. Please contact your supervisor for more information.</p>'
//     }

//       <p style="margin-top: 20px;">Thank you for using ${organizationName || 'Attendix'}.</p>
//     </div>
//   `;

//   return {
//     to: employeeEmail,
//     subject,
//     html
//   };
// }

// async function sendLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status }) {
//   if (!employeeEmail) {
//     throw new Error('Employee email is required');
//   }
//   const mail = buildLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status });
//   const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
//   return sendMail({ from, ...mail });
// }

// function buildEmployeeCredentialsEmail({ employeeEmail, employeeName, organizationName, password }) {
//   const subject = `[${organizationName || 'Attendix'}] Your account login credentials`;
//   const html = `
//     <div style="font-family: Arial, sans-serif; line-height: 1.5;">
//       <h2>Welcome to ${organizationName || 'Attendix'}</h2>
//       <p>Hi ${employeeName || 'Employee'},</p>
//       <p>Your account has been created. Use the credentials below to log in:</p>
//       <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
//         <p><strong>Email:</strong> ${employeeEmail}</p>
//         <p><strong>Password:</strong> ${password}</p>
//       </div>
//       <p>Please change your password after your first login.</p>
//     </div>
//   `;

//   return {
//     to: employeeEmail,
//     subject,
//     html
//   };
// }

// async function sendEmployeeCredentialsEmail({ employeeEmail, employeeName, organizationName, password }) {
//   if (!employeeEmail) {
//     throw new Error('Employee email is required');
//   }
//   if (!password) {
//     throw new Error('Password is required');
//   }

//   const mail = buildEmployeeCredentialsEmail({
//     employeeEmail,
//     employeeName,
//     organizationName,
//     password
//   });
//   const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
//   return sendMail({ from, ...mail });
// }

// function buildAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate }) {
//   // Format date as DD-MM-YYYY
//   const formatDate = (dateStr) => {
//     if (!dateStr) return "";
//     const d = new Date(dateStr);
//     const day = String(d.getDate()).padStart(2, "0");
//     const month = String(d.getMonth() + 1).padStart(2, "0");
//     const year = d.getFullYear();
//     return `${day}-${month}-${year}`;
//   };

//   const formattedDate = formatDate(workDate);
//   const subject = `[${organizationName || 'Attendix'}] Auto-Absent Notification`;

//   const html = `
//     <div style="font-family: Arial, sans-serif; line-height: 1.5;">
//       <h2 style="color: #dc3545;">Auto-Absent Marked</h2>
//       <p>Dear ${employeeName},</p>
//       <p>You have been automatically marked as <strong style="color: #dc3545;">Absent</strong> for <strong>${formattedDate}</strong>.</p>

//       <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
//         <p>This action was taken because the system did not record any clock-in activity or an approved leave request for you on this date.</p>
//       </div>

//       <p>If you believe this is an error, please contact your manager or the HR department immediately to rectify your attendance records.</p>

//       <p style="margin-top: 20px;">Thank you,<br/>${organizationName || 'Attendix'} Team</p>
//     </div>
//   `;

//   const mailOptions = {
//     to: employeeEmail,
//     subject,
//     html
//   };

//   // Agar admin ka email mila, toh use CC mein add kar do
//   if (adminEmail) {
//     mailOptions.cc = adminEmail;
//   }

//   return mailOptions;
// }

// async function sendAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate }) {
//   if (!employeeEmail) {
//     throw new Error('Employee email is required');
//   }
//   const mail = buildAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate });
//   const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
//   // sendMail emailService ki apni function hai
//   return sendMail({ from, ...mail });
// }

// module.exports = {
//   sendNewLeaveRequestEmail,
//   sendLeaveStatusEmail,
//   sendEmployeeCredentialsEmail,
//   sendAutoAbsentEmail
// };
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

  console.log("📨 Email sent:", info.messageId);
  console.log("🔗 Preview URL:", nodemailer.getTestMessageUrl(info));

  return info;
}

// Combine manager + admin emails into a single deduped recipient list
function getRequestRecipients({ managerEmail, adminEmail }) {
  const emails = [managerEmail, adminEmail]
    .filter(Boolean)
    .map((e) => e.trim())
    .filter((e, idx, arr) => arr.indexOf(e) === idx); // dedupe (case-sensitive)
  return emails;
}

// Base URL of the deployed Attendix frontend.
// 👉 Set FRONTEND_URL in your .env, e.g. FRONTEND_URL=https://admin.attendixapp.com
function getAppUrl(path = '') {
  const base = (process.env.FRONTEND_URL || 'https://admin.attendixapp.com').replace(/\/$/, '');
  return `${base}${path}`;
}

// Format date as DD-MM-YYYY
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Table-based button so it renders correctly across email clients (Outlook, Gmail, etc.)
// FIX: outer table now has width="100%" + align="center" wrapper so the button
// is truly centered in the card instead of sticking to the left.
function renderButton(url, label, color = '#4f46e5') {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 28px 0 8px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td align="center" bgcolor="${color}" style="border-radius: 8px;">
                <a href="${url}" target="_blank"
                   style="display:inline-block; padding: 13px 30px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px; letter-spacing: 0.2px;">
                  ${label}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

// Small colored pill used to show request status at a glance
function renderStatusPill(text, color) {
  return `
    <span style="display:inline-block; padding:4px 12px; border-radius:999px; background:${color}1A; color:${color}; font-size:12px; font-weight:bold; letter-spacing:0.3px;">
      ${text.toUpperCase()}
    </span>
  `;
}

// One aligned label/value row inside the info card
function renderInfoRow(label, value, isLast = false) {
  if (!value && value !== 0) return '';
  return `
    <tr>
      <td style="padding: 9px 0; ${isLast ? '' : 'border-bottom: 1px solid #eef0f2;'} font-size:13px; color:#6b7280; width: 110px; vertical-align: top;">${label}</td>
      <td style="padding: 9px 0; ${isLast ? '' : 'border-bottom: 1px solid #eef0f2;'} font-size:14px; color:#111827; font-weight:500;">${value}</td>
    </tr>
  `;
}

// Wraps a set of info rows in a bordered card
function renderInfoCard(rowsHtml) {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f9fafb; border:1px solid #eef0f2; border-radius:10px; padding: 4px 18px; margin: 18px 0;">
      ${rowsHtml}
    </table>
  `;
}

// Shared wrapper so every email has a consistent card look
function renderEmailShell({ icon = '📋', headline, headlineColor = '#111827', accentColor = '#4f46e5', bodyHtml, footerText }) {
  return `
    <div style="background-color:#eef0f3; padding: 40px 16px; font-family: Arial, sans-serif;">
      <div style="max-width: 540px; margin: 0 auto; background:#ffffff; border-radius: 14px; overflow:hidden; box-shadow: 0 4px 14px rgba(17,24,39,0.08);">
        <div style="height:6px; background:${accentColor};"></div>
        <div style="padding: 30px 32px 8px 32px;">
          <div style="display:flex; align-items:center; margin-bottom: 18px;">
            <span style="font-size:22px; vertical-align:middle;">${icon}</span>
            <h2 style="margin:0 0 0 10px; color:${headlineColor}; font-size: 19px; display:inline-block; vertical-align:middle;">${headline}</h2>
          </div>
          ${bodyHtml}
        </div>
        <div style="background:#fafafa; padding: 16px 32px; border-top: 1px solid #f0f0f0;">
          <p style="margin:0; font-size: 12px; color:#9ca3af;">${footerText || 'This is an automated email from Attendix.'}</p>
        </div>
      </div>
    </div>
  `;
}

/* ===================== LEAVE REQUEST (new) ===================== */

function buildLeaveEmail({ adminEmail, managerEmail, organizationName, employeeName, leave }) {
  const formattedStart = formatDate(leave.startDate);
  const formattedEnd = formatDate(leave.endDate);
  const subject = `[${organizationName || 'Attendix'}] New leave request from ${employeeName}`;

  const rows = [
    renderInfoRow('Employee', employeeName),
    renderInfoRow('Type', leave.type),
    renderInfoRow('Start Date', formattedStart),
    renderInfoRow('End Date', formattedEnd),
    renderInfoRow('Reason', leave.reason, true)
  ].join('');

  const bodyHtml = `
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 0 0 4px 0;">
      A new leave request has been submitted and is waiting for your review.
    </p>
    ${renderInfoCard(rows)}
    ${renderButton(getAppUrl('/login'), 'Review in Attendix')}
  `;

  const html = renderEmailShell({
    icon: '🗓️',
    headline: 'New Leave Request',
    bodyHtml
  });

  return {
    to: getRequestRecipients({ managerEmail, adminEmail }),
    subject,
    html
  };
}

async function sendNewLeaveRequestEmail({ adminEmail, managerEmail, organizationName, employeeName, leave }) {
  if (!adminEmail && !managerEmail) {
    throw new Error('ADMIN_EMAIL is not configured');
  }
  const mail = buildLeaveEmail({ adminEmail, managerEmail, organizationName, employeeName, leave });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

/* ===================== WFH (Work From Home) EMAIL ===================== */

function buildWfhEmail({ adminEmail, managerEmail, organizationName, employeeName, wfh }) {
  const formattedStart = formatDate(wfh.startDate);
  const formattedEnd = formatDate(wfh.endDate);
  const subject = `[${organizationName || 'Attendix'}] New WFH request from ${employeeName}`;

  const rows = [
    renderInfoRow('Employee', employeeName),
    renderInfoRow('Start Date', formattedStart),
    renderInfoRow('End Date', formattedEnd),
    renderInfoRow('Reason', wfh.reason, true)
  ].join('');

  const bodyHtml = `
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 0 0 4px 0;">
      A new Work From Home request has been submitted and is waiting for your review.
    </p>
    ${renderInfoCard(rows)}
    ${renderButton(getAppUrl('/login'), 'Review in Attendix')}
  `;

  const html = renderEmailShell({
    icon: '🏠',
    headline: 'New Work From Home Request',
    bodyHtml
  });

  return {
    to: getRequestRecipients({ managerEmail, adminEmail }),
    subject,
    html
  };
}

async function sendNewWfhRequestEmail({ adminEmail, managerEmail, organizationName, employeeName, wfh }) {
  if (!adminEmail && !managerEmail) {
    throw new Error('ADMIN_EMAIL is not configured');
  }
  const mail = buildWfhEmail({ adminEmail, managerEmail, organizationName, employeeName, wfh });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

function buildWfhStatusEmail({ employeeEmail, employeeName, organizationName, wfh, status }) {
  const formattedStart = formatDate(wfh.startDate);
  const formattedEnd = formatDate(wfh.endDate);
  const isApproved = status === 'approved';
  const statusText = isApproved ? 'Approved' : 'Rejected';
  const statusColor = isApproved ? '#16a34a' : '#dc2626';

  const subject = `[${organizationName || 'Attendix'}] Your WFH request has been ${statusText}`;

  const rows = [
    renderInfoRow('Start Date', formattedStart),
    renderInfoRow('End Date', formattedEnd),
    renderInfoRow('Reason', wfh.reason, true)
  ].join('');

  const bodyHtml = `
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 0 0 14px 0;">Dear ${employeeName},</p>
    <p style="margin: 0 0 4px 0;">${renderStatusPill(statusText, statusColor)}</p>
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 10px 0 4px 0;">
      Your Work From Home request has been <strong style="color:${statusColor};">${statusText.toLowerCase()}</strong>.
    </p>
    ${renderInfoCard(rows)}
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 4px 0 0 0;">
      ${isApproved
      ? 'Please plan accordingly.'
      : 'Please contact your supervisor for more information.'}
    </p>
    ${renderButton(getAppUrl('/login'), 'View in Attendix', statusColor)}
  `;

  const html = renderEmailShell({
    icon: isApproved ? '✅' : '❌',
    headline: `WFH Request ${statusText}`,
    headlineColor: statusColor,
    accentColor: statusColor,
    bodyHtml,
    footerText: `Thank you for using ${organizationName || 'Attendix'}.`
  });

  return {
    to: employeeEmail,
    subject,
    html
  };
}

async function sendWfhStatusEmail({ employeeEmail, employeeName, organizationName, wfh, status }) {
  if (!employeeEmail) {
    throw new Error('Employee email is required');
  }
  const mail = buildWfhStatusEmail({ employeeEmail, employeeName, organizationName, wfh, status });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

/* ===================== LEAVE STATUS ===================== */

function buildLeaveStatusEmail({ employeeEmail, employeeName, organizationName, leave, status }) {
  const formattedStart = formatDate(leave.startDate);
  const formattedEnd = formatDate(leave.endDate);
  const isApproved = status === 'approved';
  const statusText = isApproved ? 'Approved' : 'Rejected';
  const statusColor = isApproved ? '#16a34a' : '#dc2626';

  const subject = `[${organizationName || 'Attendix'}] Your leave request has been ${statusText}`;

  const rows = [
    renderInfoRow('Type', leave.type),
    renderInfoRow('Start Date', formattedStart),
    renderInfoRow('End Date', formattedEnd),
    renderInfoRow('Reason', leave.reason, true)
  ].join('');

  const bodyHtml = `
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 0 0 14px 0;">Dear ${employeeName},</p>
    <p style="margin: 0 0 4px 0;">${renderStatusPill(statusText, statusColor)}</p>
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 10px 0 4px 0;">
      Your leave request has been <strong style="color:${statusColor};">${statusText.toLowerCase()}</strong>.
    </p>
    ${renderInfoCard(rows)}
    <p style="color:#4b5563; font-size:14px; line-height:1.5; margin: 4px 0 0 0;">
      ${isApproved
      ? 'Please plan accordingly.'
      : 'Please contact your supervisor for more information.'}
    </p>
    ${renderButton(getAppUrl('/login'), 'View in Attendix', statusColor)}
  `;

  const html = renderEmailShell({
    icon: isApproved ? '✅' : '❌',
    headline: `Leave Request ${statusText}`,
    headlineColor: statusColor,
    accentColor: statusColor,
    bodyHtml,
    footerText: `Thank you for using ${organizationName || 'Attendix'}.`
  });

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

/* ===================== CREDENTIALS & AUTO-ABSENT (unchanged) ===================== */

function buildEmployeeCredentialsEmail({ employeeEmail, employeeName, organizationName, password }) {
  const subject = `[${organizationName || 'Attendix'}] Your account login credentials`;

  const bodyHtml = `
    <p style="color:#374151; font-size:14px;">Hi ${employeeName || 'Employee'},</p>
    <p style="color:#374151; font-size:14px;">Your account has been created. Use the credentials below to log in:</p>
    <div style="background-color:#f8f9fa; padding:16px; border-radius:8px; margin:16px 0;">
      <p style="margin:4px 0; font-size:14px;"><strong>Email:</strong> ${employeeEmail}</p>
      <p style="margin:4px 0; font-size:14px;"><strong>Password:</strong> ${password}</p>
    </div>
    <p style="color:#374151; font-size:14px;">Please change your password after your first login.</p>
    ${renderButton(getAppUrl('/login'), 'Log in to Attendix')}
  `;

  const html = renderEmailShell({
    icon: '👋',
    headline: `Welcome to ${organizationName || 'Attendix'}`,
    bodyHtml
  });

  return {
    to: employeeEmail,
    subject,
    html
  };
}

async function sendEmployeeCredentialsEmail({ employeeEmail, employeeName, organizationName, password }) {
  if (!employeeEmail) {
    throw new Error('Employee email is required');
  }
  if (!password) {
    throw new Error('Password is required');
  }

  const mail = buildEmployeeCredentialsEmail({
    employeeEmail,
    employeeName,
    organizationName,
    password
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

function buildAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate }) {
  const formattedDate = formatDate(workDate);
  const subject = `[${organizationName || 'Attendix'}] Auto-Absent Notification`;

  const bodyHtml = `
    <p style="color:#374151; font-size:14px;">Dear ${employeeName},</p>
    <p style="color:#374151; font-size:14px;">You have been automatically marked as <strong style="color:#dc2626;">Absent</strong> for <strong>${formattedDate}</strong>.</p>

    <div style="background-color:#f8f9fa; padding:16px; border-radius:8px; margin:16px 0;">
      <p style="margin:4px 0; font-size:14px;">This action was taken because the system did not record any clock-in activity or an approved leave request for you on this date.</p>
    </div>

    <p style="color:#374151; font-size:14px;">If you believe this is an error, please contact your manager or the HR department immediately to rectify your attendance records.</p>
    ${renderButton(getAppUrl('/login'), 'View Attendance', '#dc2626')}
  `;

  const html = renderEmailShell({
    icon: '⚠️',
    headline: 'Auto-Absent Marked',
    headlineColor: '#dc2626',
    accentColor: '#dc2626',
    bodyHtml,
    footerText: `${organizationName || 'Attendix'} Team`
  });

  const mailOptions = {
    to: employeeEmail,
    subject,
    html
  };

  if (adminEmail) {
    mailOptions.cc = adminEmail;
  }

  return mailOptions;
}

async function sendAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate }) {
  if (!employeeEmail) {
    throw new Error('Employee email is required');
  }
  const mail = buildAutoAbsentEmail({ employeeEmail, adminEmail, employeeName, organizationName, workDate });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@attendix.local';
  return sendMail({ from, ...mail });
}

module.exports = {
  sendNewLeaveRequestEmail,
  sendLeaveStatusEmail,
  sendEmployeeCredentialsEmail,
  sendAutoAbsentEmail,
  sendNewWfhRequestEmail,
  sendWfhStatusEmail
};