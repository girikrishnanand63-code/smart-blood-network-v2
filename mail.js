async function sendOtpEmail(toEmail, otp) {
    // 1. Render Logs me guaranteed print (Terminal me hamesha aayega)
    console.log("==================================================");
    console.log(`🔑 [OTP DISPATCH] Recipient: ${toEmail} | Code: ${otp}`);
    console.log("==================================================");

    const RESEND_API_KEY = process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.trim() : null;

    if (!RESEND_API_KEY) {
        console.log("⚠️ RESEND_API_KEY environment variable missing hai Render par.");
        return true;
    }

    // 2. HTTPS Web API (Port 443) - Render isko block nahi kar sakta
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
            console.error("❌ Resend API Error:", data.message || JSON.stringify(data));
        } else {
            console.log(`✅ [EMAIL DELIVERED] Real email inbox me deliver ho gayi! ID: ${data.id}`);
        }
    } catch (err) {
        console.error("❌ Network fetch failed:", err.message);
    }

    return true;
}

export { sendOtpEmail };