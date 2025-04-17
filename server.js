const express = require('express');
const { useMultiFileAuthState, makeWASocket, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Initialize
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  req.setTimeout(15000);
  res.setTimeout(15000);
  next();
});

// Session management
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// Debug endpoint
app.get('/debug', (req, res) => {
  res.json({
    status: 'active',
    sessionsDir: fs.existsSync(SESSIONS_DIR),
    system: {
      node: process.version,
      memory: process.memoryUsage().rss / (1024 * 1024) + 'MB'
    }
  });
});

// Pairing endpoint
app.get('/pair', async (req, res) => {
  try {
    const { number } = req.query;
    
    if (!number) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone number is required'
      });
    }

    if (!number.match(/^254[17][0-9]{8}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Kenyan number format'
      });
    }

    const sessionDir = path.join(SESSIONS_DIR, `session_${number}_${Date.now()}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Firefox'),
      logger: pino({ level: 'silent' })
    });

    socket.ev.on('creds.update', saveCreds);

    // Connection with timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

      socket.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const pairingCode = await socket.requestPairingCode(number);
    
    res.json({
      success: true,
      pairCode: pairingCode.match(/.{1,3}/g)?.join('-'),
      expiresIn: 120
    });

    setTimeout(() => {
      socket.end();
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }, 120000);

  } catch (error) {
    console.error('Pairing error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('Critical error:', err);
});
