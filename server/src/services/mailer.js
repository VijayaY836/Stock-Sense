import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/** Sends the OTP by email when SMTP is configured; otherwise prints it (local/offline mode). */
// In tests we capture codes here instead of emailing them
export const testOutbox = [];

export async function sendOtp(to, name, otp) {
  if (config.isTest) {
    testOutbox.push({ to, otp });
    return;
  }
  if (!transporter) {
    if (!config.isTest) {
      console.log(`\n[OTP] Password reset code for ${to}: ${otp}  (valid ${config.otp.ttlMinutes} min)\n`);
    }
    return;
  }
  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: `${otp} is your StockSense reset code`,
    text: `Hi ${name},\n\nYour StockSense password reset code is ${otp}. It expires in ${config.otp.ttlMinutes} minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
  });
}
