require("dotenv").config();
const crypto = require("crypto");
const { sendOtpEmail } = require("./mail");
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

/* JWT secret with fail-safe fallback */
const SECRET = process.env.JWT_SECRET || "bloodDonorSecretKey2026_Secure_JWT";

const WAIT_DAYS = 90;
const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const COMPATIBLE = {
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
    const email = (process.env.ADMIN_EMAIL || "girikrishnanand63@gmail.com").trim().toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || "Admin@123456";
    
    const existing = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!existing) {
        db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
            .run("Administrator", email, bcrypt.hashSync(pass, 10));
        console.log("Admin account successfully created for", email);
    } else if (existing.role !== 'admin') {
        db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);
    }
})();

const app = express();
app.set("trust proxy", 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src-attr": ["'unsafe-inline'"],
            "upgrade-insecure-requests": null
        }
    }
}));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// Direct Google Search Console Verification Route
app.get("/google692d880d16198008.html", (req, res) => {
    res.type("text/html").send("google-site-verification: google692d880d16198008.html");
});

/* ---------- Helpers ---------- */
const donorCode = id => "BD" + (1000 + id);
const requestCode = id => "RQ" + (1000 + id);
const clean = v => String(v ?? "").trim();
const validPhone = p => /^[0-9]{10}$/.test(p);
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
const todayStr = () => new Date().toISOString().slice(0, 10);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function isAvailable(lastDonation) {
    if (!lastDonation) return true;
    return (Date.now() - new Date(lastDonation).getTime()) / 86400000 >= WAIT_DAYS;
}

function donorOut(d, showPhone) {
    return {
        dbId: d.id,
        id: donorCode(d.id),
        name: d.name,
        age: d.age,
        bloodGroup: d.blood_group,
        city: d.city,
        phone: showPhone ? d.phone : null,
        lastDonation: d.last_donation || "",
        available: isAvailable(d.last_donation)
    };
}

function findMatches(group, city, requesterId) {
    const allowed = COMPATIBLE[group] || [];
    const marks = allowed.map(() => "?").join(",");
    return db.prepare(`
        SELECT * FROM donors
        WHERE blood_group IN (${marks})
          AND lower(city) = lower(?)
          AND (last_donation IS NULL OR last_donation <= date('now','-${WAIT_DAYS} day'))
          AND (user_id IS NULL OR user_id != ?)
    `).all(...allowed, city, requesterId);
}

/* ---------- Auth Middleware ---------- */
app.use("/api", (req, res, next) => {
    const token = req.cookies.sbd_token;
    if (token) {
        try {
            const payload = jwt.verify(token, SECRET);
            const u = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(payload.id);
            if (u) req.user = u;
        } catch (e) { /* invalid token */ }
    }
    next();
});

const requireAuth = (req, res, next) =>
    req.user ? next() : bad(res, "Please log in first.", 401);

const requireAdmin = (req, res, next) =>
    req.user && req.user.role === "admin" ? next() : bad(res, "Admin access only.", 403);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." }
});

/* ---------- OTP Database Table ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS pending_signups (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sends INTEGER NOT NULL DEFAULT 1,
    last_sent_at INTEGER NOT NULL
);`);

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS = 5;

const makeOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashOtp = (email, otp) =>
    crypto.createHmac("sha256", SECRET).update(email + ":" + otp).digest("hex");

function safeEqual(a, b) {
    const A = Buffer.from(a), B = Buffer.from(b);
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

setInterval(() => {
    db.prepare("DELETE FROM pending_signups WHERE expires_at < ?").run(Date.now() - 3600000);
}, 15 * 60 * 1000);

/* ---------- Auth Routes ---------- */
app.post("/api/auth/signup", authLimiter, async (req, res) => {
    const name = clean(req.body.name);
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password ?? "");
    const role = req.body.role;

    if (name.length < 2 || name.length > 60) return bad(res, "Enter a valid name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, "Enter a valid email address.");
    if (password.length < 8 || password.length > 72) return bad(res, "Password must be 8 to 72 characters.");
    if (!["donor", "recipient"].includes(role)) return bad(res, "Select an account type.");

    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) {
        return bad(res, "An account with this email already exists.", 409);
    }

    const now = Date.now();
    const existing = db.prepare("SELECT * FROM pending_signups WHERE email=?").get(email);
    let sends = 1;
    if (existing && existing.expires_at > now) {
        if (now - existing.last_sent_at < OTP_RESEND_COOLDOWN_MS)
            return bad(res, "Please wait a minute before requesting another OTP.", 429);
        if (existing.sends >= OTP_MAX_SENDS)
            return bad(res, "Too many OTP requests. Try again after 10 minutes.", 429);
        sends = existing.sends + 1;
    }

    const otp = makeOtp();
    db.prepare(`
        INSERT INTO pending_signups(email,name,password_hash,role,otp_hash,expires_at,attempts,sends,last_sent_at)
        VALUES(?,?,?,?,?,?,0,?,?)
        ON CONFLICT(email) DO UPDATE SET
            name=excluded.name, password_hash=excluded.password_hash, role=excluded.role,
            otp_hash=excluded.otp_hash, expires_at=excluded.expires_at, attempts=0,
            sends=excluded.sends, last_sent_at=excluded.last_sent_at
    `).run(email, name, bcrypt.hashSync(password, 10), role, hashOtp(email, otp),
           now + OTP_TTL_MS, sends, now);

    try {
        await sendOtpEmail(email, name, otp);
    } catch (e) {
        console.error("OTP email failed:", e && e.message ? e.message : e);
        db.prepare("DELETE FROM pending_signups WHERE email=?").run(email);
        return bad(res, "Could not send the OTP email. Please try again later.", 502);
    }
    res.status(201).json({ ok: true, otpSent: true });
});

app.post("/api/auth/verify-otp", authLimiter, (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const otp = clean(req.body.otp);
    if (!/^\d{6}$/.test(otp)) return bad(res, "Enter a valid 6-digit verification code.");

    const p = db.prepare("SELECT * FROM pending_signups WHERE email=?").get(email);
    if (!p) return bad(res, "No pending signup found. Please sign up again.", 404);
    if (Date.now() > p.expires_at) {
        db.prepare("DELETE FROM pending_signups WHERE email=?").run(email);
        return bad(res, "OTP expired. Please sign up again.", 410);
    }
    if (p.attempts >= OTP_MAX_ATTEMPTS) {
        db.prepare("DELETE FROM pending_signups WHERE email=?").run(email);
        return bad(res, "Too many wrong attempts. Please sign up again.", 429);
    }
    if (!safeEqual(hashOtp(email, otp), p.otp_hash)) {
        db.prepare("UPDATE pending_signups SET attempts = attempts + 1 WHERE email=?").run(email);
        const left = OTP_MAX_ATTEMPTS - p.attempts - 1;
        return bad(res, "Incorrect OTP. " + left + " attempt(s) left.");
    }

    try {
        db.transaction(() => {
            db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
                .run(p.name, p.email, p.password_hash, p.role);
            db.prepare("DELETE FROM pending_signups WHERE email=?").run(email);
        })();
    } catch (e) {
        return bad(res, "An account with this email already exists.", 409);
    }
    res.status(201).json({ ok: true });
});

app.post("/api/auth/resend-otp", authLimiter, async (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const p = db.prepare("SELECT * FROM pending_signups WHERE email=?").get(email);
    if (!p) return bad(res, "No pending signup found. Please sign up again.", 404);

    const now = Date.now();
    if (now - p.last_sent_at < OTP_RESEND_COOLDOWN_MS)
        return bad(res, "Please wait a minute before requesting another OTP.", 429);
    if (p.sends >= OTP_MAX_SENDS)
        return bad(res, "Too many OTP requests. Please try again later.", 429);

    const otp = makeOtp();
    db.prepare(`UPDATE pending_signups
                SET otp_hash=?, expires_at=?, attempts=0, sends=sends+1, last_sent_at=? WHERE email=?`)
        .run(hashOtp(email, otp), now + OTP_TTL_MS, now, email);
    try {
        await sendOtpEmail(email, p.name, otp);
    } catch (e) {
        console.error("OTP email failed:", e && e.message ? e.message : e);
        return bad(res, "Could not send the OTP email. Please try again later.", 502);
    }
    res.json({ ok: true });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password ?? "");
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
        return bad(res, "Invalid email or password.", 401);

    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "7d" });
    res.cookie("sbd_token", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        maxAge: 7 * 24 * 3600 * 1000
    });
    res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("sbd_token");
    res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
    if (!req.user) return res.json({ user: null });
    const pending = db.prepare(
        "SELECT COUNT(*) c FROM notifications WHERE donor_user_id=? AND status='pending'"
    ).get(req.user.id).c;
    res.json({ user: { ...req.user, pending } });
});

/* ---------- Donors Routes ---------- */
app.get("/api/donors", (req, res) => {
    const group = clean(req.query.bloodGroup);
    const city = clean(req.query.city);
    const rows = db.prepare(`
        SELECT * FROM donors
        WHERE (? = '' OR blood_group = ?)
          AND (? = '' OR lower(city) LIKE '%' || lower(?) || '%')
        ORDER BY id DESC LIMIT 100
    `).all(group, group, city, city);
    res.json(rows.map(d => donorOut(d, !!req.user)));
});

app.get("/api/donors/mine", requireAuth, (req, res) => {
    const rows = db.prepare("SELECT * FROM donors WHERE user_id=?").all(req.user.id);
    res.json(rows.map(d => donorOut(d, true)));
});

app.post("/api/donors", requireAuth, (req, res) => {
    const name = clean(req.body.name);
    const age = parseInt(req.body.age, 10);
    const group = clean(req.body.bloodGroup);
    const city = clean(req.body.city);
    const phone = clean(req.body.phone);
    const last = clean(req.body.lastDonation);

    if (name.length < 2 || name.length > 60) return bad(res, "Enter a valid name.");
    if (!(age >= 18 && age <= 65)) return bad(res, "Donor age must be between 18 and 65.");
    if (!GROUPS.includes(group)) return bad(res, "Select a valid blood group.");
    if (city.length < 2 || city.length > 60) return bad(res, "Enter a valid city.");
    if (!validPhone(phone)) return bad(res, "Enter a valid 10-digit phone number.");
    if (last && (!validDate(last) || last > todayStr())) return bad(res, "Invalid last donation date.");

    if (db.prepare("SELECT 1 FROM donors WHERE user_id=?").get(req.user.id))
        return bad(res, "You are already registered as a donor.", 409);

    if (db.prepare("SELECT 1 FROM donors WHERE phone=?").get(phone))
        return bad(res, "This phone number is already registered with another donor.", 409);

    const info = db.prepare(
        "INSERT INTO donors(user_id,name,age,blood_group,city,phone,last_donation) VALUES(?,?,?,?,?,?,?)"
    ).run(req.user.id, name, age, group, city, phone, last || null);
    res.status(201).json({ donorId: donorCode(Number(info.lastInsertRowid)) });
});

/* ---------- Blood Requests Routes ---------- */
const createRequest = db.transaction((user, data) => {
    const info = db.prepare(`
        INSERT INTO requests(user_id,patient,blood_group,units,hospital,city,phone,needed_by,urgency)
        VALUES(?,?,?,?,?,?,?,?,?)
    `).run(user.id, data.patient, data.group, data.units, data.hospital, data.city,
           data.phone, data.neededBy, data.urgency);
    const requestId = Number(info.lastInsertRowid);

    const matched = findMatches(data.group, data.city, user.id);
    const ins = db.prepare(
        "INSERT INTO notifications(request_id,donor_id,donor_user_id) VALUES(?,?,?)"
    );
    let notified = 0;
    for (const d of matched) {
        if (d.user_id) { ins.run(requestId, d.id, d.user_id); notified++; }
    }
    return { requestId, matched, notified };
});

app.post("/api/requests", requireAuth, (req, res) => {
    const urgency = ["Normal", "Urgent", "Emergency"].includes(req.body.urgency) ? req.body.urgency : "Normal";
    const data = {
        patient: clean(req.body.patient),
        group: clean(req.body.bloodGroup),
        units: parseInt(req.body.units, 10),
        hospital: clean(req.body.hospital),
        city: clean(req.body.city),
        phone: clean(req.body.phone),
        neededBy: urgency === "Emergency" ? todayStr() : clean(req.body.neededBy),
        urgency
    };
    if (data.patient.length < 2 || data.patient.length > 80) return bad(res, "Enter a valid patient name.");
    if (!GROUPS.includes(data.group)) return bad(res, "Select a valid blood group.");
    if (!(data.units >= 1 && data.units <= 10)) return bad(res, "Units must be between 1 and 10.");
    if (data.hospital.length < 2 || data.hospital.length > 100) return bad(res, "Enter a valid hospital name.");
    if (data.city.length < 2 || data.city.length > 60) return bad(res, "Enter a valid city.");
    if (!validPhone(data.phone)) return bad(res, "Enter a valid 10-digit phone number.");
    if (!validDate(data.neededBy) || data.neededBy < todayStr()) return bad(res, "Choose a valid required-by date.");

    const result = createRequest(req.user, data);
    res.status(201).json({
        code: requestCode(result.requestId),
        notified: result.notified,
        matched: result.matched.map(d => donorOut(d, true))
    });
});

app.get("/api/requests/mine", requireAuth, (req, res) => {
    const reqs = db.prepare("SELECT * FROM requests WHERE user_id=? ORDER BY id DESC").all(req.user.id);
    const notes = db.prepare(`
        SELECT n.request_id, n.status, d.name, d.phone
        FROM notifications n JOIN donors d ON d.id = n.donor_id
        WHERE n.request_id IN (SELECT id FROM requests WHERE user_id=?)
    `).all(req.user.id);

    res.json(reqs.map(r => {
        const rn = notes.filter(n => n.request_id === r.id);
        const count = s => rn.filter(n => n.status === s).length;
        return {
            dbId: r.id,
            code: requestCode(r.id),
            patient: r.patient,
            bloodGroup: r.blood_group,
            units: r.units,
            hospital: r.hospital,
            city: r.city,
            neededBy: r.needed_by,
            urgency: r.urgency,
            status: r.status,
            counts: { total: rn.length, pending: count("pending"), accepted: count("accepted"), declined: count("declined") },
            acceptedDonors: rn.filter(n => n.status === "accepted").map(n => ({ name: n.name, phone: n.phone }))
        };
    }));
});

app.post("/api/requests/:id/fulfill", requireAuth, (req, res) => {
    const info = db.prepare("UPDATE requests SET status='Fulfilled' WHERE id=? AND user_id=?")
        .run(req.params.id, req.user.id);
    if (info.changes === 0) return bad(res, "Request not found.", 404);
    res.json({ ok: true });
});

/* ---------- Notifications ---------- */
app.get("/api/notifications", requireAuth, (req, res) => {
    const rows = db.prepare(`
        SELECT n.id, n.status, r.id rid, r.patient, r.blood_group, r.units, r.hospital,
               r.city, r.phone, r.needed_by, r.urgency
        FROM notifications n JOIN requests r ON r.id = n.request_id
        WHERE n.donor_user_id = ?
        ORDER BY n.id DESC
    `).all(req.user.id);

    res.json(rows.map(n => ({
        id: n.id,
        status: n.status,
        request: {
            code: requestCode(n.rid),
            patient: n.patient,
            bloodGroup: n.blood_group,
            units: n.units,
            hospital: n.hospital,
            city: n.city,
            neededBy: n.needed_by,
            urgency: n.urgency,
            phone: n.status === "accepted" ? n.phone : null
        }
    })));
});

app.post("/api/notifications/:id/respond", requireAuth, (req, res) => {
    const status = req.body.status;
    if (!["accepted", "declined"].includes(status)) return bad(res, "Invalid response.");

    const note = db.prepare(
        "SELECT * FROM notifications WHERE id=? AND donor_user_id=? AND status='pending'"
    ).get(req.params.id, req.user.id);
    if (!note) return bad(res, "Request not found or already answered.", 404);

    db.transaction(() => {
        db.prepare("UPDATE notifications SET status=?, responded_at=datetime('now') WHERE id=?")
            .run(status, note.id);
        if (status === "accepted") {
            db.prepare("UPDATE requests SET status='Accepted' WHERE id=? AND status='Open'")
                .run(note.request_id);
        }
    })();
    res.json({ ok: true });
});

/* ---------- Admin Routes ---------- */
app.get("/api/admin/summary", requireAuth, requireAdmin, (req, res) => {
    const users = db.prepare("SELECT name,email,role FROM users ORDER BY id").all();
    const donors = db.prepare("SELECT * FROM donors ORDER BY id DESC").all().map(d => donorOut(d, true));
    const requests = db.prepare("SELECT * FROM requests ORDER BY id DESC").all().map(r => ({
        dbId: r.id, code: requestCode(r.id), patient: r.patient, bloodGroup: r.blood_group,
        city: r.city, urgency: r.urgency, status: r.status
    }));
    const accepted = db.prepare("SELECT COUNT(*) c FROM notifications WHERE status='accepted'").get().c;
    res.json({ users, donors, requests, accepted });
});

app.delete("/api/admin/donors/:id", requireAuth, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM donors WHERE id=?").run(req.params.id);
    res.json({ ok: true });
});

app.delete("/api/admin/requests/:id", requireAuth, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM requests WHERE id=?").run(req.params.id);
    res.json({ ok: true });
});

/* ---------- Health & Static Files ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "public")));

// Fallback for API 404
app.use("/api", (req, res) => bad(res, "Not found.", 404));

// SPA catch-all fallback
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Server error. Please try again." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log("Server running on port " + PORT));
