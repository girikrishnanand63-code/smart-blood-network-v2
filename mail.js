async function sendOtpEmail(toEmail, otp) {
    // 1. Render logs me real-time OTP confirmation
    console.log("==================================================");
    console.log(`🔑 [OTP DISPATCH] Recipient: ${toEmail} | Code: ${otp}`);
    console.log("==================================================");

    const BREVO_API_KEY = process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.trim() : null;
    const SENDER_EMAIL = (process.env.GMAIL_USER || "girikrishnanand63@gmail.com").trim();

    if (!BREVO_API_KEY) {
        console.log("⚠️ BREVO_API_KEY missing in environment variables.");
        return true;
    }

    // 2. Brevo HTTPS API (Port 443 - zero SMTP blocking)
    try {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                sender: {
                    name: "Smart Blood Donor Network",
                    email: SENDER_EMAIL
                },
                to: [{ email: toEmail.trim() }],
                subject: "Your Blood Donor Network Verification Code",
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; padding: 24px; color: #222; max-width: 500px; margin: auto; border: 1px solid #fee2e2; border-radius: 8px;">
                        <h2 style="color: #dc2626; margin-top: 0;">Smart Blood Donor Network</h2>
                        <p style="font-size: 15px;">Your verification code for registration:</p>
                        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 14px 24px; display: inline-block; font-size: 28px; font-weight: bold; letter-spacing: 6px; border-radius: 6px;">
                            ${otp}
                        </div>
                        <p style="margin-top: 20px; color: #666; font-size: 13px;">Valid for 10 minutes. If you did not request this, please ignore.</p>
                    </div>
                `
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Brevo API Error:", data.message || JSON.stringify(data));
        } else {
            console.log(`✅ [EMAIL DELIVERED VIA BREVO] Message ID: ${data.messageId}`);
        }
    } catch (err) {
        console.error("❌ Network dispatch failed:", err.message);
    }

    return true;
}

export { sendOtpEmail };