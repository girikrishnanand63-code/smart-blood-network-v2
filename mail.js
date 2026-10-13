import nodemailer from "nodemailer";

let transporter = null;

if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true, // Port 465 ke liye direct SSL encryption
        auth: {
            user: process.env.GMAIL_USER.trim(),
            pass: process.env.GMAIL_PASS.trim()
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 10000,
        greetingTimeout: 8000,
        socketTimeout: 12000
    });

    // Startup check: confirm credentials on server boot
    transporter.verify((error) => {
        if (error) {
            console.error("❌ Gmail SMTP Auth/Connection Error:", error.message);
        } else {
            console.log("✅ Gmail SMTP is READY. Direct emails enabled for:", process.env.GMAIL_USER);
        }
    });
}

async function sendOtpEmail(toEmail, otp) {
    // 1. Render Logs me guaranteed print (Kabhi miss nahi hoga)
    console.log("==================================================");
    console.log(`🔑 [OTP DISPATCH] Recipient: ${toEmail} | Code: ${otp}`);
    console.log("==================================================");

    if (!transporter) {
        console.log("⚠️ GMAIL_USER ya GMAIL_PASS environment variables missing hain.");
        return true;
    }

    // 2. Direct Gmail inbox me real email dispatch
    try {
        const info = await transporter.sendMail({
            from: `"Smart Blood Donor Network" <${process.env.GMAIL_USER.trim()}>`,
            to: toEmail,
            subject: "Your Blood Donor Network Verification Code",
            text: `Your verification OTP is: ${otp}. It will expire in 10 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 24px; color: #222; max-width: 500px; margin: auto; border: 1px solid #fee2e2; border-radius: 8px;">
                    <h2 style="color: #dc2626; margin-top: 0;">Smart Blood Donor Network</h2>
                    <p style="font-size: 15px;">Your verification code for registration:</p>
                    <div style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 14px 24px; display: inline-block; font-size: 28px; font-weight: bold; letter-spacing: 6px; border-radius: 6px;">
                        ${otp}
                    </div>
                    <p style="margin-top: 20px; color: #666; font-size: 13px;">Valid for 10 minutes. If you did not request this, please ignore.</p>
                </div>
            `
        });

        console.log(`✅ [GMAIL SENT] Real email delivered to ${toEmail}. ID: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error("❌ Gmail Send Error:", err.message);
        return true;
    }
}

export { sendOtpEmail };