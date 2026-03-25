require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Address Configuration
const RECEIVING_ADDRESS = process.env.RECEIVING_ADDRESS || "YourSolanaAddressHere";
const VANITY_ADDRESS = process.env.VANITY_ADDRESS || RECEIVING_ADDRESS;

// ✅ Middleware
app.use(express.json());
app.use(cors()); // Enable CORS if frontend requests are from a different origin
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: https://arweave.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'"
    );
    next();
});

// ✅ Serve Static Files
const publicPath = path.resolve(__dirname, 'public');
app.use(express.static(publicPath));

// ✅ Serve `index.html` as the default route
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// ✅ Serve holders dashboard
app.get('/holders', (req, res) => {
    res.sendFile(path.join(publicPath, 'holders.html'));
});

// ✅ API Endpoint to Get the Public Address
app.get('/api/address', (req, res) => {
    res.json({ address: VANITY_ADDRESS });
    console.log(`📡 Served address: ${VANITY_ADDRESS}`);
});

// ✅ Path to `tokens.json` (inside `src/data/`)
const dataDir = path.join(__dirname, 'data');
const tokensFile = path.join(dataDir, 'tokens.json');
const holdersFile = path.join(dataDir, 'holders.json');

// ✅ Ensure the `data/` Directory Exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ✅ Ensure `tokens.json` Exists and is Valid
if (!fs.existsSync(tokensFile) || fs.statSync(tokensFile).size === 0) {
    fs.writeFileSync(tokensFile, JSON.stringify([], null, 2));
}

// ✅ Helper Function to Read Tokens and Auto-Cleanup Expired Entries
const readTokens = () => {
    try {
        const fileContents = fs.readFileSync(tokensFile, 'utf8');
        let tokens = fileContents ? JSON.parse(fileContents) : [];
        const now = Date.now();

        // Filter out expired tokens dynamically when accessed
        const validTokens = tokens.filter(entry => entry.expiresAt > now);

        // If expired tokens were found, update the file
        if (validTokens.length !== tokens.length) {
            console.log(`🗑️ Auto-removed ${tokens.length - validTokens.length} expired requests`);
            writeTokens(validTokens);
        }

        return validTokens;
    } catch (error) {
        console.error("❌ Error reading tokens.json:", error);
        return [];
    }
};


// ✅ Helper Function to Write Tokens Safely
const writeTokens = (tokens) => {
    try {
        fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error("❌ Error writing to tokens.json:", error);
    }
};

// ✅ Function to Remove Expired Requests
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

// ✅ Function to Generate a Small Random SOL Amount
const generateRandomAmount = () => {
    return (Math.random() * (0.00001 - 0.00000001) + 0.00000001).toFixed(8);
};

// ✅ POST Endpoint to Generate a Payment Request
app.post('/payment-request', (req, res) => {
    const { discordId, twitterHandle, walletAddress } = req.body;

    if (!discordId || !twitterHandle || !walletAddress) {
        return res.status(400).json({ error: "Missing discordId, twitterHandle, or walletAddress" });
    }

    // ✅ Cleanup expired requests before adding a new one
    cleanupExpiredRequests();

    // ✅ Create a unique token (stored internally)
    const token = uuidv4();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // ✅ Generate random amount to send
    const amount = generateRandomAmount();

    // ✅ Store request internally
    const requestEntry = {
        discordId,
        twitterHandle,
        walletAddress,
        token, // Stored internally
        expiresAt,
        amount,
        receivingAddress: RECEIVING_ADDRESS
    };

    // ✅ Read existing data
    let requests = readTokens();

    // ✅ Add new request
    requests.push(requestEntry);

    // ✅ Save updated list
    writeTokens(requests);

    // ✅ Respond with only necessary info
    res.json({
        expiresAt,
        amount,
        receivingAddress: RECEIVING_ADDRESS
    });
});

// ✅ API endpoint to return holders data
app.get('/api/holders', (req, res) => {
    try {
        if (!fs.existsSync(holdersFile)) {
            return res.json([]);
        }
        const raw = fs.readFileSync(holdersFile, 'utf8');
        const holders = raw ? JSON.parse(raw) : [];
        return res.json(holders);
    } catch (error) {
        console.error("❌ Error reading holders.json:", error);
        return res.status(500).json({ error: "Failed to read holders data" });
    }
});


// ✅ Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
