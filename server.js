const express = require('express');
const crypto = require('crypto');
const app = express();
const port = 8080;
const host = '0.0.0.0';

// In-memory storage for pairing codes (use a database in production)
const pairingCodes = new Map();

app.use(express.json());

// Helper function to generate random pairing codes
function generatePairingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Endpoint to generate a new pairing code
app.post('/generate-pair-code', (req, res) => {
  try {
    const { number } = req.body;
    
    if (!number || !/^\d{6,20}$/.test(number)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid phone number format' 
      });
    }

    // Generate a new code
    const code = generatePairingCode();
    const expiresAt = Date.now() + 300000; // 5 minutes expiration
    
    // Store the code
    pairingCodes.set(number, {
      code,
      expiresAt,
      verified: false
    });

    return res.json({
      success: true,
      code,
      expiresAt: new Date(expiresAt).toISOString()
    });

  } catch (error) {
    console.error('Error generating pair code:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Endpoint to verify a pairing code
app.post('/verify-pair-code', (req, res) => {
  try {
    const { number, code } = req.body;
    
    if (!number || !code) {
      return res.status(400).json({
        success: false,
        message: 'Number and code are required'
      });
    }

    const storedData = pairingCodes.get(number);
    
    if (!storedData) {
      return res.json({
        success: false,
        message: 'No active pairing session for this number'
      });
    }

    if (Date.now() > storedData.expiresAt) {
      pairingCodes.delete(number);
      return res.json({
        success: false,
        message: 'Pairing code has expired'
      });
    }

    if (storedData.code !== code.toUpperCase()) {
      return res.json({
        success: false,
        message: 'Invalid pairing code'
      });
    }

    // Mark as verified
    pairingCodes.set(number, {
      ...storedData,
      verified: true
    });

    return res.json({
      success: true,
      message: 'Pairing code verified successfully'
    });

  } catch (error) {
    console.error('Error verifying pair code:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Endpoint to get credentials after successful pairing
app.get('/get-credentials', (req, res) => {
  try {
    const { number } = req.query;
    
    if (!number) {
      return res.status(400).json({
        success: false,
        message: 'Number is required'
      });
    }

    const storedData = pairingCodes.get(number);
    
    if (!storedData) {
      return res.json({
        success: false,
        message: 'No pairing session found'
      });
    }

    if (!storedData.verified) {
      return res.json({
        success: false,
        message: 'Pairing code not verified'
      });
    }

    // In a real implementation, you would generate actual WhatsApp credentials here
    const credentials = {
      clientId: crypto.randomBytes(16).toString('hex'),
      clientToken: crypto.randomBytes(32).toString('hex'),
      serverToken: crypto.randomBytes(32).toString('hex'),
      encKey: crypto.randomBytes(32).toString('hex'),
      macKey: crypto.randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString()
    };

    // Clear the pairing code after successful credential generation
    pairingCodes.delete(number);

    return res.json({
      success: true,
      credentials
    });

  } catch (error) {
    console.error('Error getting credentials:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Cleanup expired codes every hour
setInterval(() => {
  const now = Date.now();
  for (const [number, data] of pairingCodes.entries()) {
    if (now > data.expiresAt) {
      pairingCodes.delete(number);
    }
  }
}, 3600000); // 1 hour

app.get('/', (req, res) => {
  res.send("WhatsApp Pairing API is running");
});

app.listen(port, host, () => {
  console.log(`Pairing API listening at http://${host}:${port}`);
});
