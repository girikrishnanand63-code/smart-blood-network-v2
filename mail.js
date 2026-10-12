import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

async function sendOtpEmail(toEmail, toName, otp) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.log(`\n[DEV ONLY] OTP for ${toEmail}: ${otp}\n`);
        return true;
    }

    await transporter.sendMail({
        from: `"Smart Blood Donor Network" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: "Your Blood Donor Network Verification Code",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #c0182b; text-align: center;">ðŸ©¸ Smart Blood Donor Network</h2>
                <p>Hello <strong>${toName || "User"}</strong>,</p>
                <p>Enter the verification code below to activate your account:</p>
                <div style="text-align: center; margin: 25px 0;">
                    <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #c0182b; background: #fdecee; padding: 10px 22px; border-radius: 6px; display: inline-block;">
                        ${otp}
                    </span>
                </div>
                <p style="color: #666; font-size: 13px;">This code is valid for 10 minutes. If you did not request this, please ignore this email.</p>
            </div>
        `
    });

    return true;
}

export { sendOtpEmail };