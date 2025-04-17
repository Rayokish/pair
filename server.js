const express = require('express');
const { useMultiFileAuthState, makeWASocket, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Session storage directory
const SESSIONS_DIR = path.join(__dirname, 'sessions');

// Create directory if it doesn't exist
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR);
}

// Cleanup old sessions
const cleanupSessions = () => {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
    
    fs.readdirSync(SESSIONS_DIR).forEach(file => {
        const filePath = path.join(SESSIONS_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory() && stats.birthtimeMs < cutoff) {
            fs.rmSync(filePath, { recursive: true, force: true });
        }
    });
};

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ status: 'running', service: 'WhatsApp Pairing API' });
});

// Pairing endpoint
app.get('/pair', async (req, res) => {
    const { number } = req.query;
    
    // Input validation
    if (!number) {
        return res.status(400).json({ 
            success: false,
            message: 'Phone number is required'
        });
    }

    // Validate Kenyan number format
    if (!number.match(/^254[17][0-9]{8}$/)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid Kenyan number format. Use 2547XXXXXXX'
        });
    }

    try {
        cleanupSessions();
        
        const sessionDir = path.join(SESSIONS_DIR, `session_${number}_${Date.now()}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Firefox'),
            logger: pino({ level: 'silent' })
        });

        socket.ev.on('creds.update', saveCreds);

        // Wait for connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);

            socket.ev.on('connection.update', (update) => {
                if (update.connection === 'open') {
                    clearTimeout(timeout);
                    resolve();
                } else if (update.connection === 'close') {
                    clearTimeout(timeout);
                    reject(new Error('Connection closed'));
                }
            });
        });

        // Get pairing code
        const pairingCode = await socket.requestPairingCode(number);
        const formattedCode = pairingCode.match(/.{1,3}/g)?.join('-') || pairingCode;

        // Success response
        res.status(200).json({
            success: true,
            pairCode: formattedCode,
            expiresIn: 120 // seconds
        });

        // Cleanup after 2 minutes
        setTimeout(() => {
            socket.end();
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }, 120000);

    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate pairing code'
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`WhatsApp Pairing API running on port ${port}`);
    // Cleanup sessions every hour
    setInterval(cleanupSessions, 60 * 60 * 1000);
});
