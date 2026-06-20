import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer'; // <-- NEW: Imported Nodemailer

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors()); // Allows your frontend to talk to this backend
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// Initialize SQLite Database (creates a local file called bookings.db)
const db = new sqlite3.Database('./bookings.db', (err) => {
    if (err) console.error("Database error: ", err.message);
    else console.log("Connected to SQLite database.");
});

// Create the bookings table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id TEXT UNIQUE, -- e.g., "2026-06-15_court_1_8"
    court_id TEXT,
    date TEXT,
    hour INTEGER,
    status TEXT,
    customer_name TEXT,
    customer_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ===================================================================
// --- NEW: Email Configuration (Nodemailer) ---
// ===================================================================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

const MANAGER_EMAIL = process.env.MANAGER_EMAIL;

function formatHourToAMPM(hour) {
    let rawHour = hour % 24;
    const period = hour < 12 || hour >= 24 ? 'AM' : 'PM';
    let displayHour = rawHour > 12 ? rawHour - 12 : (rawHour === 0 ? 12 : rawHour);
    return `${displayHour}:00 ${period}`;
}

async function sendConfirmationEmails(bookingData) {
    const { slots, status, customerName, customerEmail } = bookingData;
    
    const readableSlots = slots.map(slot => {
        const [date, court, hour] = slot.split('_');
        return `<li>Date: <strong>${date}</strong> | Time: <strong>${formatHourToAMPM(parseInt(hour))}</strong></li>`;
    }).join('');

    const statusText = status === 'booked' ? 'Paid & Confirmed ✅' : 'Pending Walk-in Payment ⏳';

    const emailHTML = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
            <h2 style="color: #004d40;">Pickle Pal Booking Confirmation</h2>
            <p>Hi ${customerName},</p>
            <p>Your booking request has been received. Here are your reservation details:</p>
            <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p><strong>Status:</strong> ${statusText}</p>
                <ul style="line-height: 1.6;">
                    ${readableSlots}
                </ul>
            </div>
            <p>We look forward to seeing you at Court Yard Central!</p>
            <p style="font-size: 0.8rem; color: #666; margin-top: 30px;">For questions, message us on Facebook at Payag Sa PangPang.</p>
        </div>
    `;

    // Send to Customer
    transporter.sendMail({
        from: '"Pickle Pal Reservations" <payagsapangpang@gmail.com>',
        to: customerEmail,
        subject: `Your Pickle Pal Booking: ${statusText}`,
        html: emailHTML
    }).catch(err => console.error("Customer Email failed:", err));

    // Send to Manager
    transporter.sendMail({
        from: '"Pickle Pal System" <payagsapangpang@gmail.com>',
        to: MANAGER_EMAIL,
        subject: `NEW BOOKING: ${customerName} (${slots.length} slots)`,
        html: `<p>New booking alert from <b>${customerName}</b> (${customerEmail}).</p>` + emailHTML
    }).catch(err => console.error("Manager Email failed:", err));
}
// ===================================================================

// --- API ROUTE 1: Get Bookings for a Specific Date ---
app.get('/api/bookings/:date', (req, res) => {
    const targetDate = req.params.date;
    
    db.all(`SELECT slot_id, status FROM bookings WHERE date = ?`, [targetDate], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Convert array of rows into a dictionary for the frontend
        const bookedSlots = {};
        rows.forEach(row => {
            bookedSlots[row.slot_id] = row.status;
        });
        
        res.json(bookedSlots);
    });
});

// --- API ROUTE 2: Submit a New Booking ---
app.post('/api/book', (req, res) => {
    const { slots, status, customerName, customerEmail } = req.body;
    
    // 1. QUERY THE DB: Check if ANY of the requested slots are already taken
    const placeholders = slots.map(() => '?').join(',');
    const checkQuery = `SELECT slot_id FROM bookings WHERE slot_id IN (${placeholders})`;

    db.all(checkQuery, slots, (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });

        // 2. REJECT IF OCCUPIED
        if (rows.length > 0) {
            const takenSlots = rows.map(r => r.slot_id).join(', ');
            return res.status(409).json({ 
                error: "Double Booking Prevented", 
                message: `Sorry, these slots were taken: ${takenSlots}` 
            });
        }

        // 3. INSERT IF AVAILABLE
        const insertStmt = db.prepare(`INSERT INTO bookings (slot_id, court_id, date, hour, status, customer_name, customer_email) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        
        let hasError = false;
        slots.forEach(slotId => {
            const [date, court, hour] = slotId.split('_'); // e.g. "2026-06-15", "court_1", "8"
            
            insertStmt.run([slotId, court, date, parseInt(hour), status, customerName, customerEmail], (err) => {
                if (err) hasError = true;
            });
        });

        insertStmt.finalize();

        if (hasError) {
            return res.status(500).json({ error: "Failed to save some bookings." });
        }

        // ==========================================================
        // NEW: TRIGGER EMAILS AFTER SUCCESSFUL DATABASE INSERTION
        // ==========================================================
        // Only send if we actually received an email from the frontend
        if (customerEmail) {
            sendConfirmationEmails(req.body);
        }

        res.json({ success: true, message: "Booking confirmed successfully!" });
    });
});

// --- API ROUTE 3: Admin Dashboard (Get ALL Bookings) ---
app.get('/api/admin/bookings', (req, res) => {
    
    // 1. Check the password sent by the browser
    const providedPass = req.headers.authorization;
    
    if (providedPass !== process.env.ADMIN_PASS) {
        // If it doesn't match, send a 401 Unauthorized error
        return res.status(401).json({ error: "Access Denied: Incorrect password." });
    }

    // 2. If the password matches, fetch the data
    db.all(`SELECT * FROM bookings ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));