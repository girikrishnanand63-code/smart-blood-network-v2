const RESEND_API_KEY = process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.trim() : null;

async function sendOtpEmail(toEmail, otp) {
    // 1. Guaranteed Render Log: Har case mein OTP turant terminal par print hoga
    console.log(`=========================================`);
    console.log(`🔑 [OTP GENERATED] For: ${toEmail} | CODE: ${otp}`);
    console.log(`=========================================`);

    // Agar Resend API key nahi hai, yahi se return ho jao
    if (!RESEND_API_KEY) {
        console.log(`⚠️ RESEND_API_KEY missing in environment variables.`);
        return true;
    }

    // 2. Real email send attempt via Resend
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
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #dc2626;">Blood Donor Network Verification</h2>
                        <p>Use the verification code below to complete your registration:</p>
                        <h1 style="background: #fef2f2; color: #dc2626; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 6px;">${otp}</h1>
                        <p style="margin-top: 20px; color: #666; font-size: 13px;">Valid for 10 minutes. If you did not request this, please ignore.</p>
                    </div>
                `
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`❌ Resend Error: Status ${response.status}`, data);
        } else {
            console.log(`✅ [EMAIL DELIVERED VIA RESEND] Message ID: ${data.id}`);
        }
    } catch (err) {
        console.error(`❌ Fetch dispatch failed:`, err.message);
    }

    return true;
}

export { sendOtpEmail };