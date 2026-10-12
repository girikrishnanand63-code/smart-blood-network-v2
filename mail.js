import nodemailer from "nodemailer";

let transporter;

if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    transporter = nodemailer.createTransporter({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        }
    });
}

async function sendOtpEmail(toEmail, otp) {
    if (!transporter) {
        console.log(`[DEV / FALLBACK EMAIL] OTP for ${toEmail}: ${otp}`);
        return true;
    }

    try {
        await transporter.sendMail({
            from: `"Smart Blood Donor Network" <${process.env.GMAIL_USER}>`,
            to: toEmail,
            subject: "Your Blood Donor Network Verification Code",
            text: `Your verification OTP is: ${otp}. It will expire in 10 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #dc2626;">Blood Donor Network Verification</h2>
                    <p>Use the verification code below to complete your registration:</p>
                    <h1 style="background: #fef2f2; color: #dc2626; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 6px;">${otp}</h1>
                    <p style="margin-top: 20px; color: #666; font-size: 13px;">Valid for 10 minutes. If you did not request this, please ignore.</p>
                </div>
            `
        });
        return true;
    } catch (err) {
        console.error("Nodemailer Error, falling back to console:", err.message);
        console.log(`[FALLBACK EMAIL] OTP for ${toEmail}: ${otp}`);
        return true;
    }
}

export { sendOtpEmail };