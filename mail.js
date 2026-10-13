const RESEND_API_KEY = process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.trim() : null;

async function sendOtpEmail(toEmail, otp) {
    if (!RESEND_API_KEY) {
        console.log(`[DEV / FALLBACK EMAIL] OTP for ${toEmail}: ${otp}`);
        return true;
    }

    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: "Blood Network <onboarding@resend.dev>",
                to: [toEmail],
                subject: "Your Blood Donor Network Verification Code",
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 24px; color: #222; max-width: 500px; margin: auto; border: 1px solid #fee2e2; border-radius: 8px;">
                        <h2 style="color: #dc2626; margin-top: 0;">Blood Donor Network</h2>
                        <p style="font-size: 15px;">Your one-time verification code is:</p>
                        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 14px 24px; display: inline-block; font-size: 28px; font-weight: bold; letter-spacing: 6px; border-radius: 6px;">
                            ${otp}
                        </div>
                        <p style="margin-top: 20px; color: #666; font-size: 13px;">This code is valid for 10 minutes. If you did not request this, please ignore.</p>
                    </div>
                `
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Resend API Error:", data.message || JSON.stringify(data));
            console.log(`[FALLBACK EMAIL] OTP for ${toEmail}: ${otp}`);
            return true;
        }

        console.log(`✅ [EMAIL SENT VIA RESEND] Successfully sent to ${toEmail}. ID: ${data.id}`);
        return true;
    } catch (err) {
        console.error("❌ Resend dispatch failed:", err.message);
        console.log(`[FALLBACK EMAIL] OTP for ${toEmail}: ${otp}`);
        return true;
    }
}

export { sendOtpEmail };