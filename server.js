import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import { sendOtpEmail } from "./mail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "bloodDonorSecretKey2026_Secure_JWT";

/* ---------- Blood Compatibility Matrix ---------- */
const COMPATIBILITY = {
    "A+": ["A+", "AB+"],
    "A-": ["A+", "A-", "AB+", "AB-"],
    "B+": ["B+", "AB+"],
    "B-": ["B+", "B-", "AB+", "AB-"],
    "AB+": ["AB+"],
    "AB-": ["AB+", "AB-"],
    "O+": ["A+", "B+", "AB+", "O+"],
    "O-": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
};

/* ---------- Reverse Compatibility: Who can donate to this recipient ---------- */
const CAN_RECEIVE_FROM = {
    "A+": ["A+", "A-", "O+", "O-"],
    "A-": ["A-", "O-"],
    "B+": ["B+", "B-", "O+", "O-"],
    "B-": ["B-", "O-"],
    "AB+": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    "AB-": ["A-", "B-", "AB-", "O-"],
    "O+": ["O+", "O-"],
    "O-": ["O-"]
};

/* ---------- Bootstrap First Admin with guaranteed fallback ---------- */
(function bootstrapAdmin() {
    try {
        const email = (process.env.ADMIN_EMAIL || "girikrishnanand63@gmail.com").trim().toLowerCase();
        const pass = process.env.ADMIN_PASSWORD || "Admin@123456";

        const existing = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        const hash = bcrypt.hashSync(pass, 10);
        if (!existing) {
            db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
                .run("Administrator", email, hash);
            console.log("Admin account successfully created for", email);
        } else {
            db.prepare("UPDATE users SET password_hash=?, role='admin' WHERE email=?")
                .run(hash, email);
            console.log("Admin account verified & credentials updated for", email);
        }
    } catch (err) {
        console.error("Bootstrap Admin Error:", err.message);
    }
})();

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(cookieParser());

/* Serve Google Verification file explicitly */
app.get("/google692d880d16198008.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "google692d880d16198008.html"));
});

app.use(express.static(path.join(__dirname, "public")));

/* ---------- Helpers ---------- */
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function authMiddleware(req, res, next) {
    const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(" ")[1]);
    if (!token) return res.status(401).json({ error: "Unauthorized: Please login" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

function adminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
        next();
    });
}

/* =========================================================================
   AUTH ROUTES
   ========================================================================= */

app.post("/api/auth/signup", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email and password are required" });
        }
        const cleanEmail = email.trim().toLowerCase();
        const existing = db.prepare("SELECT id FROM users WHERE email=?").get(cleanEmail);
        if (existing) {
            return res.status(400).json({ error: "Email is already registered" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const assignedRole = role === "donor" ? "donor" : "recipient";

        const info = db.prepare(`
            INSERT INTO users(name, email, password_hash, role)
            VALUES(?,?,?,?)
        `).run(name.trim(), cleanEmail, passwordHash, assignedRole);

        const newUser = { id: info.lastInsertRowid, name: name.trim(), email: cleanEmail, role: assignedRole };
        const token = generateToken(newUser);

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ message: "Registration successful", user: newUser, token });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ error: "Registration failed" });
    }
});

app.post("/api/auth/register-request", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email and password are required" });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }
        const cleanEmail = email.trim().toLowerCase();

        const existing = db.prepare("SELECT id FROM users WHERE email=?").get(cleanEmail);
        if (existing) {
            return res.status(400).json({ error: "Email is already registered" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const passwordHash = await bcrypt.hash(password, 10);
        const assignedRole = role === "donor" ? "donor" : "recipient";

        db.prepare("DELETE FROM pending_registrations WHERE email=?").run(cleanEmail);
        db.prepare(`
            INSERT INTO pending_registrations(email, name, password_hash, role, otp, expires_at)
            VALUES(?,?,?,?,?,?)
        `).run(cleanEmail, name.trim(), passwordHash, assignedRole, otp, expiresAt);

        await sendOtpEmail(cleanEmail, otp);
        res.json({ message: "Verification code sent to your email" });
    } catch (err) {
        console.error("Register request error:", err);
        res.status(500).json({ error: "Failed to send verification email" });
    }
});

app.post("/api/auth/register-verify", async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });

        const cleanEmail = email.trim().toLowerCase();
        const pending = db.prepare("SELECT * FROM pending_registrations WHERE email=?").get(cleanEmail);
        if (!pending) return res.status(400).json({ error: "No pending registration found for this email" });

        if (new Date(pending.expires_at) < new Date()) {
            db.prepare("DELETE FROM pending_registrations WHERE email=?").run(cleanEmail);
            return res.status(400).json({ error: "Verification code has expired. Please sign up again." });
        }

        if (pending.otp !== otp.trim()) {
            return res.status(400).json({ error: "Incorrect verification code" });
        }

        const info = db.prepare(`
            INSERT INTO users(name, email, password_hash, role)
            VALUES(?,?,?,?)
        `).run(pending.name, pending.email, pending.password_hash, pending.role);

        db.prepare("DELETE FROM pending_registrations WHERE email=?").run(cleanEmail);

        const newUser = { id: info.lastInsertRowid, name: pending.name, email: pending.email, role: pending.role };
        const token = generateToken(newUser);

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ message: "Registration successful", user: newUser, token });
    } catch (err) {
        console.error("Verify error:", err);
        res.status(500).json({ error: "Registration verification failed" });
    }
});

app.post("/api/auth/resend-otp", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email required" });
        const cleanEmail = email.trim().toLowerCase();

        const pending = db.prepare("SELECT * FROM pending_registrations WHERE email=?").get(cleanEmail);
        if (!pending) return res.status(400).json({ error: "No pending registration found" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.prepare("UPDATE pending_registrations SET otp=?, expires_at=? WHERE email=?").run(otp, expiresAt, cleanEmail);

        await sendOtpEmail(cleanEmail, otp);
        res.json({ message: "New verification code sent" });
    } catch (err) {
        res.status(500).json({ error: "Failed to resend code" });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

        const cleanEmail = email.trim().toLowerCase();
        const user = db.prepare("SELECT * FROM users WHERE email=?").get(cleanEmail);
        if (!user) return res.status(401).json({ error: "Invalid email or password" });

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: "Invalid email or password" });

        const token = generateToken(user);
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            message: "Login successful",
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            token
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Login failed" });
    }
});

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
    const user = db.prepare("SELECT id, name, email, role, created_at FROM users WHERE id=?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const donor = db.prepare("SELECT * FROM donors WHERE user_id=?").get(user.id);
    res.json({ user, donorProfile: donor || null });
});

/* =========================================================================
   DONORS
   ========================================================================= */

app.post("/api/donors/register", authMiddleware, (req, res) => {
    try {
        const { name, age, blood_group, city, contact, last_donation_date, consent } = req.body;
        if (!name || !age || !blood_group || !city || !contact) {
            return res.status(400).json({ error: "All required donor fields must be provided" });
        }
        if (!consent) {
            return res.status(400).json({ error: "Consent is required to list as donor" });
        }
        if (Number(age) < 18 || Number(age) > 65) {
            return res.status(400).json({ error: "Donor age must be between 18 and 65" });
        }

        const existing = db.prepare("SELECT id FROM donors WHERE user_id=?").get(req.user.id);
        if (existing) {
            db.prepare(`
                UPDATE donors
                SET name=?, age=?, blood_group=?, city=?, contact=?, last_donation_date=?, is_available=1
                WHERE user_id=?
            `).run(name.trim(), Number(age), blood_group, city.trim(), contact.trim(), last_donation_date || null, req.user.id);
            return res.json({ message: "Donor profile updated successfully" });
        }

        db.prepare(`
            INSERT INTO donors(user_id, name, age, blood_group, city, contact, last_donation_date, is_available)
            VALUES(?,?,?,?,?,?,?,1)
        `).run(req.user.id, name.trim(), Number(age), blood_group, city.trim(), contact.trim(), last_donation_date || null);

        db.prepare("UPDATE users SET role='donor' WHERE id=? AND role!='admin'").run(req.user.id);

        res.json({ message: "Donor registered successfully" });
    } catch (err) {
        console.error("Donor registration error:", err);
        res.status(500).json({ error: "Failed to register donor" });
    }
});

app.get("/api/donors/search", (req, res) => {
    try {
        const { blood_group, city } = req.query;
        let query = "SELECT id, name, blood_group, city, is_available, last_donation_date, created_at FROM donors WHERE is_available=1";
        const params = [];

        if (blood_group) {
            query += " AND blood_group=?";
            params.push(blood_group);
        }
        if (city) {
            query += " AND LOWER(city) LIKE ?";
            params.push(`%${city.trim().toLowerCase()}%`);
        }
        query += " ORDER BY created_at DESC LIMIT 50";

        const donors = db.prepare(query).all(...params);
        res.json({ donors });
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

/* =========================================================================
   BLOOD REQUESTS & NOTIFICATIONS
   ========================================================================= */

app.post("/api/requests", authMiddleware, (req, res) => {
    try {
        const { patient_name, blood_group, units, hospital, city, contact_phone, required_by, urgency } = req.body;
        if (!patient_name || !blood_group || !units || !hospital || !city || !contact_phone || !required_by) {
            return res.status(400).json({ error: "All request fields are required" });
        }

        const info = db.prepare(`
            INSERT INTO blood_requests(requester_id, patient_name, blood_group, units, hospital, city, contact_phone, required_by, urgency)
            VALUES(?,?,?,?,?,?,?,?,?)
        `).run(
            req.user.id,
            patient_name.trim(),
            blood_group,
            Number(units),
            hospital.trim(),
            city.trim(),
            contact_phone.trim(),
            required_by,
            urgency || "Normal"
        );

        const requestId = info.lastInsertRowid;
        const compatibleGroups = CAN_RECEIVE_FROM[blood_group] || [blood_group];
        const placeholders = compatibleGroups.map(() => "?").join(",");

        const matchingDonors = db.prepare(`
            SELECT id, user_id FROM donors
            WHERE is_available=1
              AND LOWER(city)=?
              AND blood_group IN (${placeholders})
        `).all(city.trim().toLowerCase(), ...compatibleGroups);

        const notifyStmt = db.prepare(`
            INSERT INTO notifications(recipient_id, request_id, message)
            VALUES(?, ?, ?)
        `);

        for (const donor of matchingDonors) {
            notifyStmt.run(
                donor.user_id,
                requestId,
                `Urgent: ${blood_group} blood needed for ${patient_name} at ${hospital}, ${city}.`
            );
        }

        res.json({
            message: `Blood request submitted. ${matchingDonors.length} compatible donor(s) notified.`,
            requestId,
            notifiedDonorsCount: matchingDonors.length
        });
    } catch (err) {
        console.error("Create request error:", err);
        res.status(500).json({ error: "Failed to submit request" });
    }
});

app.get("/api/requests/my", authMiddleware, (req, res) => {
    const requests = db.prepare(`
        SELECT * FROM blood_requests WHERE requester_id=? ORDER BY created_at DESC
    `).all(req.user.id);
    res.json({ requests });
});

app.get("/api/notifications", authMiddleware, (req, res) => {
    const notifications = db.prepare(`
        SELECT n.*, r.patient_name, r.blood_group, r.units, r.hospital, r.city, r.contact_phone, r.urgency
        FROM notifications n
        JOIN blood_requests r ON n.request_id = r.id
        WHERE n.recipient_id = ?
        ORDER BY n.created_at DESC
    `).all(req.user.id);
    res.json({ notifications });
});

app.post("/api/notifications/:id/respond", authMiddleware, (req, res) => {
    try {
        const { action } = req.body;
        if (!["accepted", "declined"].includes(action)) {
            return res.status(400).json({ error: "Action must be accepted or declined" });
        }

        const notif = db.prepare("SELECT * FROM notifications WHERE id=? AND recipient_id=?").get(req.params.id, req.user.id);
        if (!notif) return res.status(404).json({ error: "Notification not found" });

        db.prepare("UPDATE notifications SET status='read' WHERE id=?").run(notif.id);

        if (action === "accepted") {
            const donor = db.prepare("SELECT id FROM donors WHERE user_id=?").get(req.user.id);
            if (donor) {
                db.prepare(`
                    INSERT INTO donations(donor_id, request_id, status)
                    VALUES(?, ?, 'committed')
                `).run(donor.id, notif.request_id);
            }
        }

        res.json({ message: `Request ${action}` });
    } catch (err) {
        res.status(500).json({ error: "Failed to respond" });
    }
});

/* =========================================================================
   EMERGENCY BROADCAST
   ========================================================================= */

app.post("/api/emergency", (req, res) => {
    try {
        const { blood_group, city, hospital, contact_phone } = req.body;
        if (!blood_group || !city || !hospital || !contact_phone) {
            return res.status(400).json({ error: "All emergency fields are required" });
        }

        const compatibleGroups = CAN_RECEIVE_FROM[blood_group] || [blood_group];
        const placeholders = compatibleGroups.map(() => "?").join(",");

        const donors = db.prepare(`
            SELECT name, blood_group, city, contact
            FROM donors
            WHERE is_available=1
              AND LOWER(city)=?
              AND blood_group IN (${placeholders})
            LIMIT 15
        `).all(city.trim().toLowerCase(), ...compatibleGroups);

        res.json({
            message: `Emergency search completed. ${donors.length} matching donors available.`,
            donors
        });
    } catch (err) {
        res.status(500).json({ error: "Emergency lookup failed" });
    }
});

/* =========================================================================
   ADMIN DASHBOARD
   ========================================================================= */

app.get("/api/admin/stats", adminMiddleware, (req, res) => {
    try {
        const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
        const totalDonors = db.prepare("SELECT COUNT(*) AS count FROM donors").get().count;
        const totalRequests = db.prepare("SELECT COUNT(*) AS count FROM blood_requests").get().count;
        const recentUsers = db.prepare("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 10").all();
        const recentRequests = db.prepare("SELECT * FROM blood_requests ORDER BY created_at DESC LIMIT 10").all();

        res.json({
            stats: { totalUsers, totalDonors, totalRequests },
            recentUsers,
            recentRequests
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch admin stats" });
    }
});

/* Fallback: SPA routing */
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});