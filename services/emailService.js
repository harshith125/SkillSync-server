const nodemailer = require('nodemailer');

const getTransporter = () => {
    return nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
        }
    });
};

const sendEmail = async (to, subject, html) => {
    try {
        const transporter = getTransporter();
        const mailOptions = {
            from: `"SkillSync Support" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
    const subject = 'SkillSync - Password Reset Request';
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your SkillSync Password</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
        .wrapper { width: 100%; max-width: 560px; margin: 30px auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: #2563eb; padding: 24px 32px; text-align: left; }
        .logo-text { color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; margin: 0; }
        .content { padding: 32px; }
        h1 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 16px; }
        p { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px; }
        .btn-wrapper { text-align: center; margin: 28px 0; }
        .btn-reset { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; }
        .link-alt { word-break: break-all; font-size: 12px; color: #64748b; background: #f1f5f9; padding: 10px 12px; border-radius: 6px; border: 1px solid #cbd5e1; }
        .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <h2 class="logo-text">SkillSync</h2>
        </div>
        <div class="content">
          <h1>Password Reset Request</h1>
          <p>Hello,</p>
          <p>We received a request to reset your password for your SkillSync account. Click the button below to set a new password. This link is valid for <strong>60 minutes</strong>.</p>
          <div class="btn-wrapper">
            <a href="${resetUrl}" class="btn-reset" target="_blank" style="color: #ffffff;">Reset My Password</a>
          </div>
          <p>If you're having trouble clicking the button, copy and paste this URL into your browser:</p>
          <div class="link-alt">${resetUrl}</div>
          <p style="margin-top: 24px; font-size: 13px; color: #64748b;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} SkillSync. All rights reserved.
        </div>
      </div>
    </body>
    </html>
    `;

    return await sendEmail(toEmail, subject, html);
};

module.exports = { sendEmail, sendPasswordResetEmail };
