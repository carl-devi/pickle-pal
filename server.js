import dns from "dns";
// Global fix to force Node.js to use IPv4, preventing Render ENETUNREACH errors
dns.setDefaultResultOrder("ipv4first");

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors()); 
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// Initialize SQLite Database
const db = new sqlite3.Database('./bookings.db', (err) => {
    if (err) console.error("Database error: ", err.message);
    else console.log("Connected to SQLite database.");
});

// Create the bookings table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id TEXT UNIQUE, 
    court_id TEXT,
    date TEXT,
    hour INTEGER,
    status TEXT,
    customer_name TEXT,
    customer_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ===================================================================
// --- Email Configuration (Nodemailer) ---
// ===================================================================
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true, 
    
    // Backup fix ensuring IPv4 routing
    family: 4, 

    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
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
        from: `"Pickle Pal Reservations" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Your Pickle Pal Booking: ${statusText}`,
        html: emailHTML
    }).catch(err => console.error("Customer Email failed:", err));

    // Send to Manager
    transporter.sendMail({
        from: `"Pickle Pal System" <${process.env.EMAIL_USER}>`,
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
    
    const placeholders = slots.map(() => '?').join(',');
    const checkQuery = `SELECT slot_id FROM bookings WHERE slot_id IN (${placeholders})`;

    db.all(checkQuery, slots, (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error" });

        if (rows.length > 0) {
            const takenSlots = rows.map(r => r.slot_id).join(', ');
            return res.status(409).json({ 
                error: "Double Booking Prevented", 
                message: `Sorry, these slots were taken: ${takenSlots}` 
            });
        }

        const insertStmt = db.prepare(`INSERT INTO bookings (slot_id, court_id, date, hour, status, customer_name, customer_email) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        
        let hasError = false;
        slots.forEach(slotId => {
            const [date, court, hour] = slotId.split('_'); 
            
            insertStmt.run([slotId, court, date, parseInt(hour), status, customerName, customerEmail], (err) => {
                if (err) hasError = true;
            });
        });

        insertStmt.finalize();

        if (hasError) {
            return res.status(500).json({ error: "Failed to save some bookings." });
        }

        if (customerEmail) {
            sendConfirmationEmails(req.body);
        }

        res.json({ success: true, message: "Booking confirmed successfully!" });
    });
});

// --- API ROUTE 3: Admin Dashboard (Get ALL Bookings) ---
app.get('/api/admin/bookings', (req, res) => {
    
    const providedPass = req.headers.authorization;
    
    if (providedPass !== process.env.ADMIN_PASS) {
        return res.status(401).json({ error: "Access Denied: Incorrect password." });
    }

    db.all(`SELECT * FROM bookings ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));