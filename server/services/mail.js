const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/** Sends an email. Without SMTP configured (local dev) the message is printed to the console. */
async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { dev: true };
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
  return { dev: false };
}

module.exports = { sendMail };
