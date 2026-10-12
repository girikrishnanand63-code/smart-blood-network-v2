import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "blood_network.db");
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma("journal_mode = WAL");

// Database Schema Initialization
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'recipient',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    blood_group TEXT NOT NULL,
    city TEXT NOT NULL,
    contact TEXT NOT NULL,
    last_donation_date TEXT,
    is_available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blood_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER,
    patient_name TEXT NOT NULL,
    blood_group TEXT NOT NULL,
    units INTEGER NOT NULL,
    hospital TEXT NOT NULL,
    city TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    required_by TEXT NOT NULL,
    urgency TEXT DEFAULT 'Normal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'unread',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(request_id) REFERENCES blood_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    status TEXT DEFAULT 'committed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(donor_id) REFERENCES donors(id) ON DELETE CASCADE,
    FOREIGN KEY(request_id) REFERENCES blood_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_donors_search ON donors(blood_group, city);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notifications(recipient_id, status);
`);

export default db;