const express = require('express');
const { useMultiFileAuthState, makeWASocket, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting storage
const pairingAttempts = new Map();
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW = 60 * 60 * 1000; // 1 hour

// Cleanup function for temporary sessions
const cleanupOldSessions = () => {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
    const sessionsDir = path.join(__dirname, 'temp_sessions');
    
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir);
        return;
    }

    fs.readdirSync(sessionsDir).forEach(file => {
        const filePath = path.join(sessionsDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory() && stats.birthtimeMs < cutoff) {
            fs.rmSync(filePath, { recursive: true, force: true });
        }
    });
};

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'running',
        service: 'WhatsApp Pairing API',
        version: '1.0'
    });
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

    // Rate limiting check
    const now = Date.now();
    const attempts = pairingAttempts.get(number) || [];
    const recentAttempts = attempts.filter(t => now - t < ATTEMPT_WINDOW);
    
    if (recentAttempts.length >= MAX_ATTEMPTS) {
        return res.status(429).json({
            success: false,
            message: 'Too many pairing attempts. Please try again later.'
        });
    }

    pairingAttempts.set(number, [...recentAttempts, now]);
    
    try {
        cleanupOldSessions();
        
        const sessionDir = path.join(__dirname, 'temp_sessions', `session_${number}_${Date.now()}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Firefox'),
            logger: pino({ level: 'silent' })
        });

        socket.ev.on('creds.update', saveCreds);

        // Connection handler with timeout
        const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 30000); // 30 seconds timeout

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

        await connectionPromise;

        // Get pairing code with timeout
        const pairingCode = await Promise.race([
            socket.requestPairingCode(number),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Pairing code timeout')), 30000)
        ]);

        // Format code as XXX-XXX
        const formattedCode = pairingCode.match(/.{1,3}/g)?.join('-') || pairingCode;

        // Success response
        res.status(200).json({
            success: true,
            pairCode: formattedCode,
            expiresIn: 120, // seconds
            timestamp: new Date().toISOString()
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

// Verification endpoint (optional)
app.get('/verify', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ 
            success: false,
            message: 'Phone number is required'
        });
    }

    // In a real implementation, you would check your database
    // Here we just return a mock response
    res.status(200).json({
        success: true,
        paired: Math.random() > 0.5, // 50% chance
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(port, () => {
    console.log(`WhatsApp Pairing API running on port ${port}`);
    setInterval(cleanupOldSessions, 60 * 60 * 1000); // Cleanup every hour
});
