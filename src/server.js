require('dotenv').config(); // Load environment variables
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const RECEIVING_ADDRESS = process.env.RECEIVING_ADDRESS || "YourSolanaAddressHere";

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the public folder
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Serve `index.html` as the default route
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Path to tokens JSON file (inside `src/data`)
const tokensFile = path.join(__dirname, 'data', 'tokens.json');

// Ensure the 'data' directory exists
const dataDir = path.dirname(tokensFile);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure `tokens.json` exists and is valid
if (!fs.existsSync(tokensFile) || fs.statSync(tokensFile).size === 0) {
    fs.writeFileSync(tokensFile, JSON.stringify([], null, 2));
}

// Helper function to read tokens safely
const readTokens = () => {
    try {
        const fileContents = fs.readFileSync(tokensFile, 'utf8');
        return fileContents ? JSON.parse(fileContents) : [];
    } catch (error) {
        console.error("❌ Error reading tokens.json:", error);
        return [];
    }
};

// Helper function to write tokens safely
const writeTokens = (tokens) => {
    try {
        fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error("❌ Error writing to tokens.json:", error);
    }
};

// Function to remove expired requests
const cleanupExpiredRequests = () => {
    let tokens = readTokens();
    const now = Date.now();

    // Filter out expired requests
    const validTokens = tokens.filter(entry => entry.expiresAt > now);

    if (validTokens.length !== tokens.length) {
        console.log(`🗑️ Removed ${tokens.length - validTokens.length} expired requests`);
        writeTokens(validTokens);
    }
};

// Function to generate a small random SOL amount
const generateRandomAmount = () => {
    return (Math.random() * (0.00001 - 0.00000001) + 0.00000001).toFixed(8);
};

// POST endpoint to generate the payment request
app.post('/payment-request', (req, res) => {
    const { discordId, twitterHandle, walletAddress } = req.body;

    if (!discordId || !twitterHandle || !walletAddress) {
        return res.status(400).json({ error: "Missing discordId, twitterHandle, or walletAddress" });
    }

    // Cleanup expired requests before adding a new one
    cleanupExpiredRequests();

    // Create a unique token (stored internally)
    const token = uuidv4();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Generate random amount to send
    const amount = generateRandomAmount();

    // Store request internally
    const requestEntry = {
        discordId,
        twitterHandle,
        walletAddress,
        token, // Stored internally
        expiresAt,
        amount,
        receivingAddress: RECEIVING_ADDRESS
    };

    // Read existing data
    let requests = readTokens();

    // Add new request
    requests.push(requestEntry);

    // Save updated list
    writeTokens(requests);

    // Respond with only necessary info
    res.json({
        expiresAt,
        amount,
        receivingAddress: RECEIVING_ADDRESS
    });
});

// **Background Cleanup Every 5 Minutes**
setInterval(cleanupExpiredRequests, 5 * 60 * 1000);

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
