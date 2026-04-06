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

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET;
const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_BOT_TOKEN = process.env.TOKEN;

function getServerOrigin() {
    const raw = process.env.BASE_URL || `http://localhost:${PORT}`;
    try {
        const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
        if (!url.port && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
            url.port = String(PORT);
        }
        return url.origin;
    } catch (error) {
        return `http://localhost:${PORT}`;
    }
}

function getDiscordRedirectUri() {
    return `${getServerOrigin()}/auth/discord/callback`;
}

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

app.get('/auth/discord', (req, res) => {
    if (!DISCORD_CLIENT_ID) {
        return res.status(500).send("Discord client ID is not configured.");
    }

    const redirectUri = getDiscordRedirectUri();
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify",
        prompt: "consent"
    });

    return res.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send("Missing Discord authorization code.");
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.status(500).send("Discord OAuth credentials are not configured.");
    }

    try {
        const redirectUri = getDiscordRedirectUri();
        const tokenResponse = await fetch(DISCORD_OAUTH_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code: String(code),
                redirect_uri: redirectUri
            })
        });

        if (!tokenResponse.ok) {
            const errorBody = await tokenResponse.text();
            console.error("❌ Discord token exchange failed:", errorBody);
            return res.status(500).send("Discord token exchange failed.");
        }

        const tokenData = await tokenResponse.json();
        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        if (!userResponse.ok) {
            const errorBody = await userResponse.text();
            console.error("❌ Failed to fetch Discord user:", errorBody);
            return res.status(500).send("Failed to fetch Discord user.");
        }

        const discordUser = await userResponse.json();
        const discordId = discordUser.id;

        const redirect = new URL("/", getServerOrigin());
        redirect.searchParams.set("discordId", discordId);
        return res.redirect(redirect.toString());
    } catch (error) {
        console.error("❌ Discord OAuth error:", error);
        return res.status(500).send("Discord login failed.");
    }
});

// ✅ API Endpoint to Get the Public Address
app.get('/api/address', (req, res) => {
    res.json({ address: VANITY_ADDRESS });
    console.log(`📡 Served address: ${VANITY_ADDRESS}`);
});

// ✅ Resolve Discord username by ID
app.get('/api/discord-username/:id', async (req, res) => {
    const { id } = req.params;
    if (!DISCORD_BOT_TOKEN) {
        return res.status(500).json({ error: 'Discord bot token not configured.' });
    }
    try {
        const userResponse = await fetch(`https://discord.com/api/v10/users/${id}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        if (!userResponse.ok) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const user = await userResponse.json();
        return res.json({ username: user.username });
    } catch (error) {
        console.error('❌ Error resolving Discord username:', error);
        return res.status(500).json({ error: 'Failed to resolve username.' });
    }
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

const normalizeDiscordId = (discordId) => String(discordId || '').trim();
const normalizeWalletAddress = (walletAddress) => String(walletAddress || '').trim().toLowerCase();

const readHolders = () => {
    try {
        if (!fs.existsSync(holdersFile)) {
            return [];
        }
        const raw = fs.readFileSync(holdersFile, 'utf8');
        const holders = raw ? JSON.parse(raw) : [];
        return Array.isArray(holders) ? holders : [];
    } catch (error) {
        console.error("❌ Error reading holders.json:", error);
        return [];
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

    const normalizedDiscordId = normalizeDiscordId(discordId);
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    const existingHolder = readHolders().find((holder) => (
        normalizeWalletAddress(holder?.walletAddress) === normalizedWalletAddress
    ));

    if (existingHolder && normalizeDiscordId(existingHolder.discordId) !== normalizedDiscordId) {
        const ownerLabel = existingHolder.twitterHandle
            ? `@${existingHolder.twitterHandle}`
            : existingHolder.discordId || "another Discord user";
        return res.status(409).json({
            error: `That wallet is already linked to ${ownerLabel}. Ask them to unlink it before using it on a new account.`,
        });
    }

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
