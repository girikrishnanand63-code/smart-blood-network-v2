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

/* ---------- Compatibility Matrix ---------- */
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

/* ---------- Bootstrap First Admin ---------- */
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

/* Serve Google Verification file */
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
   AUTH ROUTES (Exact Match For script.js)
   ========================================================================= */

// Signup -> stores in pending table and sends 6-digit OTP
// server.js ke andar signup handler:
// Signup -> Send OTP without blocking the HTTP response
const signupHandler = async (req, res) => {
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

        // Non-blocking trigger: Browser response turant jayega
        sendOtpEmail(cleanEmail, otp).catch(e => console.error("Email send error:", e.message));

        res.json({ message: "Verification code sent to your email" });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ error: "Failed to process signup request" });
    }
};

app.post("/api/auth/signup", signupHandler);
app.post("/api/auth/register-request", signupHandler);

// Verify OTP -> creates user in users table
const verifyOtpHandler = async (req, res) => {
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

        if (pending.otp !== String(otp).trim()) {
            return res.status(400).json({ error: "Incorrect verification code" });
        }

        db.prepare(`
            INSERT INTO users(name, email, password_hash, role)
            VALUES(?,?,?,?)
        `).run(pending.name, pending.email, pending.password_hash, pending.role);

        db.prepare("DELETE FROM pending_registrations WHERE email=?").run(cleanEmail);

        res.json({ message: "Email verified! Please log in." });
    } catch (err) {
        console.error("Verify error:", err);
        res.status(500).json({ error: "Registration verification failed" });
    }
};

app.post("/api/auth/verify-otp", verifyOtpHandler);
app.post("/api/auth/register-verify", verifyOtpHandler);

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

        // Non-blocking trigger
        sendOtpEmail(cleanEmail, otp).catch(e => console.error("Resend error:", e.message));

        res.json({ message: "A new OTP has been sent." });
    } catch (err) {
        res.status(500).json({ error: "Failed to resend code" });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password required" });

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

    const pendingRow = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id=? AND status='pending'").get(user.id);
    user.pending = pendingRow ? pendingRow.c : 0;

    res.json({ user });
});

/* =========================================================================
   DONORS ROUTES (Exact Match For script.js)
   ========================================================================= */

const saveDonorHandler = (req, res) => {
    try {
        const { name, age, bloodGroup, blood_group, city, phone, contact, lastDonation, last_donation_date } = req.body;
        const group = bloodGroup || blood_group;
        const ph = phone || contact;
        const lastDon = lastDonation || last_donation_date || null;

        if (!name || !age || !group || !city || !ph) {
            return res.status(400).json({ error: "All required fields must be provided" });
        }

        const existing = db.prepare("SELECT id FROM donors WHERE user_id=?").get(req.user.id);
        let donorDbId;

        if (existing) {
            db.prepare(`
                UPDATE donors
                SET name=?, age=?, blood_group=?, city=?, contact=?, last_donation_date=?, is_available=1
                WHERE user_id=?
            `).run(name.trim(), Number(age), group, city.trim(), ph.trim(), lastDon, req.user.id);
            donorDbId = existing.id;
        } else {
            const info = db.prepare(`
                INSERT INTO donors(user_id, name, age, blood_group, city, contact, last_donation_date, is_available)
                VALUES(?,?,?,?,?,?,?,1)
            `).run(req.user.id, name.trim(), Number(age), group, city.trim(), ph.trim(), lastDon);
            donorDbId = info.lastInsertRowid;
            db.prepare("UPDATE users SET role='donor' WHERE id=? AND role!='admin'").run(req.user.id);
        }

        res.json({ message: "Donor profile saved", donorId: "D-" + donorDbId });
    } catch (err) {
        console.error("Donor save error:", err);
        res.status(500).json({ error: "Failed to register donor" });
    }
};

app.post("/api/donors", authMiddleware, saveDonorHandler);
app.post("/api/donors/register", authMiddleware, saveDonorHandler);

// Search donors
app.get("/api/donors", (req, res) => {
    try {
        const { bloodGroup, blood_group, city } = req.query;
        const group = bloodGroup || blood_group;
        let query = "SELECT id, name, age, blood_group, city, contact, is_available, last_donation_date FROM donors WHERE is_available=1";
        const params = [];

        if (group) {
            query += " AND blood_group=?";
            params.push(group);
        }
        if (city && city.trim()) {
            query += " AND LOWER(city) LIKE ?";
            params.push(`%${city.trim().toLowerCase()}%`);
        }
        query += " ORDER BY created_at DESC LIMIT 50";

        const rows = db.prepare(query).all(...params);
        const donors = rows.map(r => ({
            id: "D-" + r.id,
            dbId: r.id,
            name: r.name,
            age: r.age,
            bloodGroup: r.blood_group,
            city: r.city,
            phone: r.contact,
            available: r.is_available === 1,
            lastDonation: r.last_donation_date
        }));
        res.json(donors);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

app.get("/api/donors/mine", authMiddleware, (req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM donors WHERE user_id=?").all(req.user.id);
        const donors = rows.map(r => ({
            id: "D-" + r.id,
            dbId: r.id,
            name: r.name,
            age: r.age,
            bloodGroup: r.blood_group,
            city: r.city,
            phone: r.contact,
            available: r.is_available === 1,
            lastDonation: r.last_donation_date
        }));
        res.json(donors);
    } catch (err) {
        res.status(500).json({ error: "Failed to load donor history" });
    }
});

/* =========================================================================
   BLOOD REQUESTS & NOTIFICATIONS (Exact Match For script.js)
   ========================================================================= */

app.post("/api/requests", authMiddleware, (req, res) => {
    try {
        const { patient, patient_name, bloodGroup, blood_group, units, hospital, city, phone, contact_phone, neededBy, required_by, urgency } = req.body;
        const pat = patient || patient_name;
        const group = bloodGroup || blood_group;
        const ph = phone || contact_phone;
        const dateReq = neededBy || required_by || new Date().toISOString().slice(0, 10);

        if (!pat || !group || !hospital || !city || !ph) {
            return res.status(400).json({ error: "Required fields missing" });
        }

        const info = db.prepare(`
            INSERT INTO blood_requests(requester_id, patient_name, blood_group, units, hospital, city, contact_phone, required_by, urgency)
            VALUES(?,?,?,?,?,?,?,?,?)
        `).run(
            req.user.id,
            pat.trim(),
            group,
            Number(units || 1),
            hospital.trim(),
            city.trim(),
            ph.trim(),
            dateReq,
            urgency || "Normal"
        );

        const reqId = info.lastInsertRowid;
        const compatibleGroups = CAN_RECEIVE_FROM[group] || [group];
        const placeholders = compatibleGroups.map(() => "?").join(",");

        const matched = db.prepare(`
            SELECT id, user_id, name, blood_group, city, contact, is_available
            FROM donors
            WHERE is_available=1
              AND LOWER(city)=?
              AND blood_group IN (${placeholders})
        `).all(city.trim().toLowerCase(), ...compatibleGroups);

        const notifyStmt = db.prepare(`
            INSERT INTO notifications(recipient_id, request_id, message, status)
            VALUES(?, ?, ?, 'pending')
        `);

        for (const donor of matched) {
            notifyStmt.run(donor.user_id, reqId, `Urgent request for ${group} at ${hospital}`);
        }

        res.json({
            message: "Request registered",
            code: "REQ-" + reqId,
            notified: matched.length,
            matched: matched.map(m => ({
                id: "D-" + m.id,
                name: m.name,
                bloodGroup: m.blood_group,
                city: m.city,
                phone: m.contact,
                available: m.is_available === 1
            }))
        });
    } catch (err) {
        console.error("Create request error:", err);
        res.status(500).json({ error: "Failed to submit request" });
    }
});

const getMyRequestsHandler = (req, res) => {
    try {
        const requests = db.prepare("SELECT * FROM blood_requests WHERE requester_id=? ORDER BY created_at DESC").all(req.user.id);
        const result = requests.map(r => {
            const acceptedDonors = db.prepare(`
                SELECT d.name, d.contact AS phone
                FROM donations dn
                JOIN donors d ON dn.donor_id = d.id
                WHERE dn.request_id = ?
            `).all(r.id);

            const notifs = db.prepare("SELECT status FROM notifications WHERE request_id=?").all(r.id);
            const counts = {
                total: notifs.length,
                pending: notifs.filter(n => n.status === "pending" || n.status === "unread").length,
                accepted: acceptedDonors.length,
                declined: notifs.filter(n => n.status === "declined").length
            };

            return {
                dbId: r.id,
                code: "REQ-" + r.id,
                patient: r.patient_name,
                bloodGroup: r.blood_group,
                units: r.units,
                hospital: r.hospital,
                city: r.city,
                neededBy: r.required_by,
                urgency: r.urgency,
                status: r.status === "open" ? "Open" : "Fulfilled",
                counts,
                acceptedDonors
            };
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to load requests" });
    }
};

app.get("/api/requests/mine", authMiddleware, getMyRequestsHandler);
app.get("/api/requests/my", authMiddleware, getMyRequestsHandler);

app.post("/api/requests/:id/fulfill", authMiddleware, (req, res) => {
    try {
        db.prepare("UPDATE blood_requests SET status='fulfilled' WHERE id=? AND requester_id=?").run(req.params.id, req.user.id);
        res.json({ message: "Request marked fulfilled" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update request" });
    }
});

app.get("/api/notifications", authMiddleware, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT n.id, n.status, r.patient_name, r.blood_group, r.units, r.hospital, r.city, r.contact_phone, r.required_by, r.urgency
            FROM notifications n
            JOIN blood_requests r ON n.request_id = r.id
            WHERE n.recipient_id = ?
            ORDER BY n.created_at DESC
        `).all(req.user.id);

        const list = rows.map(r => ({
            id: r.id,
            status: r.status === "unread" ? "pending" : r.status,
            request: {
                patient: r.patient_name,
                bloodGroup: r.blood_group,
                units: r.units,
                hospital: r.hospital,
                city: r.city,
                phone: r.contact_phone,
                neededBy: r.required_by,
                urgency: r.urgency
            }
        }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Failed to load notifications" });
    }
});

app.post("/api/notifications/:id/respond", authMiddleware, (req, res) => {
    try {
        const status = req.body.status || req.body.action;
        const notif = db.prepare("SELECT * FROM notifications WHERE id=? AND recipient_id=?").get(req.params.id, req.user.id);
        if (!notif) return res.status(404).json({ error: "Notification not found" });

        db.prepare("UPDATE notifications SET status=? WHERE id=?").run(status, notif.id);

        if (status === "accepted") {
            const donor = db.prepare("SELECT id FROM donors WHERE user_id=?").get(req.user.id);
            if (donor) {
                db.prepare("INSERT INTO donations(donor_id, request_id, status) VALUES(?,?, 'committed')")
                    .run(donor.id, notif.request_id);
            }
        }
        res.json({ message: "Response recorded" });
    } catch (err) {
        res.status(500).json({ error: "Failed to respond" });
    }
});

/* =========================================================================
   ADMIN DASHBOARD (Exact Match For script.js)
   ========================================================================= */

app.get("/api/admin/summary", adminMiddleware, (req, res) => {
    try {
        const users = db.prepare("SELECT name, email, role FROM users ORDER BY created_at DESC").all();
        const donorsRows = db.prepare("SELECT id, name, blood_group, city, contact, is_available FROM donors ORDER BY created_at DESC").all();
        const requestsRows = db.prepare("SELECT id, patient_name, blood_group, city, urgency, status FROM blood_requests ORDER BY created_at DESC").all();
        const acceptedCount = db.prepare("SELECT COUNT(*) AS c FROM donations").get().c;

        const donors = donorsRows.map(d => ({
            dbId: d.id,
            id: "D-" + d.id,
            name: d.name,
            bloodGroup: d.blood_group,
            city: d.city,
            phone: d.contact,
            available: d.is_available === 1
        }));

        const requests = requestsRows.map(r => ({
            dbId: r.id,
            code: "REQ-" + r.id,
            patient: r.patient_name,
            bloodGroup: r.blood_group,
            city: r.city,
            urgency: r.urgency,
            status: r.status === "open" ? "Open" : "Fulfilled"
        }));

        res.json({ users, donors, requests, accepted: acceptedCount });
    } catch (err) {
        res.status(500).json({ error: "Admin summary failed" });
    }
});

app.delete("/api/admin/:kind/:id", adminMiddleware, (req, res) => {
    try {
        const { kind, id } = req.params;
        if (kind === "donors") {
            db.prepare("DELETE FROM donors WHERE id=?").run(id);
        } else if (kind === "requests") {
            db.prepare("DELETE FROM blood_requests WHERE id=?").run(id);
        } else {
            return res.status(400).json({ error: "Invalid kind" });
        }
        res.json({ message: "Deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete" });
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