require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const {
    readHolders,
    readVerifiedEntries,
    buildVerifiedAccountIndex,
    normalizeDiscordId,
    normalizeTwitterHandle,
    normalizeWalletAddress,
    getAccountByDiscordId,
    findAccountByWalletAddress,
    upsertVerifiedWallet,
    setPrimaryWallet,
    unlinkWallet,
    updateTwitterHandle,
} = require('./accountStore');

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
const ACCOUNT_TOKEN_SECRET =
    process.env.DISCORD_ACCOUNT_TOKEN_SECRET ||
    process.env.DISCORD_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.TOKEN ||
    "robocheck-account-secret";
const ACCOUNT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

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

function encodeTokenPayload(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signTokenPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', ACCOUNT_TOKEN_SECRET)
        .update(encodedPayload)
        .digest('base64url');
}

function issueDiscordAccountToken(discordId) {
    const payload = {
        discordId: normalizeDiscordId(discordId),
        exp: Date.now() + ACCOUNT_TOKEN_TTL_MS,
    };
    const encodedPayload = encodeTokenPayload(payload);
    return `${encodedPayload}.${signTokenPayload(encodedPayload)}`;
}

function verifyDiscordAccountToken(token) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken || !normalizedToken.includes('.')) {
        throw new Error('Missing account token.');
    }

    const [encodedPayload, signature] = normalizedToken.split('.');
    const expectedSignature = signTokenPayload(encodedPayload);
    if (!signature || signature.length !== expectedSignature.length) {
        throw new Error('Invalid account token signature.');
    }
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        throw new Error('Invalid account token signature.');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload?.discordId || !payload?.exp || Number(payload.exp) < Date.now()) {
        throw new Error('Account token expired.');
    }

    return payload;
}

function requireDiscordAccountAuth(req, res, next) {
    try {
        const authorization = String(req.headers.authorization || '');
        const token = authorization.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length).trim()
            : '';
        const payload = verifyDiscordAccountToken(token);
        req.accountAuth = payload;
        next();
    } catch (error) {
        return res.status(401).json({ error: error.message || 'Unauthorized.' });
    }
}

function getHolderByDiscordId(discordId) {
    const normalizedDiscordId = normalizeDiscordId(discordId);
    if (!normalizedDiscordId) return null;
    return readHolders().find((entry) => normalizeDiscordId(entry?.discordId) === normalizedDiscordId) || null;
}

function buildAccountResponse(discordId) {
    const normalizedDiscordId = normalizeDiscordId(discordId);
    const account = getAccountByDiscordId(normalizedDiscordId, readVerifiedEntries());
    const holder = getHolderByDiscordId(normalizedDiscordId);
    return {
        discordId: normalizedDiscordId,
        twitterHandle: account?.twitterHandle || holder?.twitterHandle || null,
        walletAddress: account?.walletAddress || holder?.walletAddress || null,
        primaryWalletAddress: account?.primaryWalletAddress || holder?.walletAddress || null,
        wallets: Array.isArray(account?.wallets)
            ? account.wallets
            : (holder?.walletAddress ? [{ walletAddress: holder.walletAddress, isPrimary: true }] : []),
        holderTokens: Array.isArray(holder?.tokens) ? holder.tokens.length : 0,
    };
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
        redirect.searchParams.set("accountToken", issueDiscordAccountToken(discordId));
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
const voltDbFile = path.resolve(__dirname, '..', '..', 'volt', 'points.db');

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

const readVoltUsernameMap = () => {
    try {
        if (!fs.existsSync(voltDbFile)) {
            return new Map();
        }

        const raw = execFileSync(
            'sqlite3',
            [
                voltDbFile,
                '-json',
                `SELECT userID, username
                 FROM economy
                 WHERE username IS NOT NULL
                   AND TRIM(username) != ''`
            ],
            { encoding: 'utf8' }
        );
        const rows = raw ? JSON.parse(raw) : [];
        return new Map(
            (Array.isArray(rows) ? rows : [])
                .filter((row) => row && row.userID && row.username)
                .map((row) => [normalizeDiscordId(row.userID), String(row.username).trim()])
        );
    } catch (error) {
        console.error('❌ Error reading Volt usernames:', error);
        return new Map();
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

    if (!discordId || !walletAddress) {
        return res.status(400).json({ error: "Missing discordId or walletAddress" });
    }

    // ✅ Cleanup expired requests before adding a new one
    cleanupExpiredRequests();

    const normalizedDiscordId = normalizeDiscordId(discordId);
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    const existingRequest = readTokens().find((entry) => (
        normalizeWalletAddress(entry?.walletAddress) === normalizedWalletAddress
    ));
    const existingAccount = findAccountByWalletAddress(normalizedWalletAddress, readVerifiedEntries());

    if (existingRequest && normalizeDiscordId(existingRequest.discordId) !== normalizedDiscordId) {
        const ownerLabel = existingRequest.twitterHandle
            ? `@${existingRequest.twitterHandle}`
            : existingRequest.discordId || "another Discord user";
        return res.status(409).json({
            error: `That wallet already has a pending verification for ${ownerLabel}. Ask them to finish or wait for it to expire before using it on a new account.`,
        });
    }

    if (existingAccount && normalizeDiscordId(existingAccount.discordId) !== normalizedDiscordId) {
        const ownerLabel = existingAccount.twitterHandle
            ? `@${existingAccount.twitterHandle}`
            : existingAccount.discordId || "another Discord user";
        return res.status(409).json({
            error: `That wallet is already linked to ${ownerLabel}. Ask them to unlink it before using it on a new account.`,
        });
    }

    if (existingAccount && normalizeDiscordId(existingAccount.discordId) === normalizedDiscordId) {
        return res.status(409).json({
            error: "That wallet is already linked to your Robo-Check account.",
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
        twitterHandle: normalizeTwitterHandle(twitterHandle) || null,
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

app.get('/api/account', requireDiscordAccountAuth, (req, res) => {
    try {
        return res.json(buildAccountResponse(req.accountAuth.discordId));
    } catch (error) {
        console.error('❌ Error loading account:', error);
        return res.status(500).json({ error: 'Failed to load account.' });
    }
});

app.put('/api/account/twitter', requireDiscordAccountAuth, (req, res) => {
    try {
        const twitterHandle = normalizeTwitterHandle(req.body?.twitterHandle);
        if (twitterHandle && !/^[A-Za-z0-9_]{1,15}$/.test(twitterHandle)) {
            return res.status(400).json({ error: 'Invalid X username.' });
        }

        const account = updateTwitterHandle(req.accountAuth.discordId, twitterHandle);
        return res.json({
            message: 'X username updated.',
            account: buildAccountResponse(account?.discordId || req.accountAuth.discordId),
        });
    } catch (error) {
        console.error('❌ Error updating twitter handle:', error);
        return res.status(400).json({ error: error.message || 'Failed to update X username.' });
    }
});

app.put('/api/account/primary-wallet', requireDiscordAccountAuth, (req, res) => {
    try {
        const walletAddress = String(req.body?.walletAddress || '').trim();
        const account = setPrimaryWallet(req.accountAuth.discordId, walletAddress);
        return res.json({
            message: 'Primary wallet updated.',
            account: buildAccountResponse(account?.discordId || req.accountAuth.discordId),
        });
    } catch (error) {
        console.error('❌ Error setting primary wallet:', error);
        return res.status(400).json({ error: error.message || 'Failed to set primary wallet.' });
    }
});

app.delete('/api/account/wallet/:walletAddress', requireDiscordAccountAuth, (req, res) => {
    try {
        const account = unlinkWallet(req.accountAuth.discordId, req.params.walletAddress);
        return res.json({
            message: 'Wallet unlinked.',
            account: buildAccountResponse(account?.discordId || req.accountAuth.discordId),
        });
    } catch (error) {
        console.error('❌ Error unlinking wallet:', error);
        return res.status(400).json({ error: error.message || 'Failed to unlink wallet.' });
    }
});

// ✅ API endpoint to return holders data
app.get('/api/holders', (req, res) => {
    try {
        const holders = readHolders();
        const accountMap = new Map();
        Array.from(buildVerifiedAccountIndex(readVerifiedEntries()).values()).forEach((account) => {
            accountMap.set(normalizeDiscordId(account.discordId), account);
        });
        const voltUsernameMap = readVoltUsernameMap();
        return res.json(holders.map((holder) => ({
            ...holder,
            walletAddress: accountMap.get(normalizeDiscordId(holder?.discordId))?.walletAddress || holder?.walletAddress || null,
            primaryWalletAddress: accountMap.get(normalizeDiscordId(holder?.discordId))?.primaryWalletAddress || holder?.walletAddress || null,
            wallets: accountMap.get(normalizeDiscordId(holder?.discordId))?.wallets || holder?.wallets || [],
            twitterHandle: accountMap.get(normalizeDiscordId(holder?.discordId))?.twitterHandle || holder?.twitterHandle || null,
            voltUsername: voltUsernameMap.get(normalizeDiscordId(holder?.discordId)) || null
        })));
    } catch (error) {
        console.error("❌ Error reading holders.json:", error);
        return res.status(500).json({ error: "Failed to read holders data" });
    }
});


// ✅ Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
