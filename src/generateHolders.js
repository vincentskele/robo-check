require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');

// ✅ Define Paths
const dataPath = path.join(__dirname, 'data');
const holdersFilePath = path.join(dataPath, 'holders.json');
const verifiedFilePath = path.join(dataPath, 'verified.json');
const solariansMintListFilePath = path.join(dataPath, 'solarians-mintlist.json');

// ✅ Ensure `data/` directory exists
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

// ✅ Load Solarians Mint List
if (!fs.existsSync(solariansMintListFilePath)) {
    console.error(`❌ Error: Missing ${solariansMintListFilePath}`);
    process.exit(1);
}
const solariansMintList = require(solariansMintListFilePath).solariansMintList || [];

if (solariansMintList.length === 0) {
    console.error(`❌ Error: solariansMintList is empty!`);
    process.exit(1);
}

// ✅ Setup Solana Connection (Use `processed` for the latest state)
const rpcEndpoint = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'); 
const connection = new Connection(rpcEndpoint, 'processed');


// ✅ Load Verified Users & Extract Wallet Info
if (!fs.existsSync(verifiedFilePath)) {
    console.error(`❌ Error: Missing ${verifiedFilePath}`);
    process.exit(1);
}
const verifiedData = JSON.parse(fs.readFileSync(verifiedFilePath, 'utf8'));
const walletInfo = verifiedData
    .filter(user => user.verified) // Only verified users
    .map(user => ({
        discordId: user.discordId,
        twitterHandle: user.twitterHandle || null, // Use null if not provided
        walletAddress: user.walletAddress
    }));

console.log("✅ Found Wallets:", walletInfo.map(w => w.walletAddress));

// 🔍 Function to Fetch Token Holdings for a Wallet (Forcing Fresh Data)
async function getTokenAccounts(wallet, retries = 3) {
    try {
        const publicKey = new PublicKey(wallet);

        // 🔥 Force an update to avoid cached results
        await connection.requestAirdrop(publicKey, 0).catch(() => {});

        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        }, 'processed'); // Use "processed" to avoid cached data

        return tokenAccounts.value
    .filter(account => account.account.data.parsed.info.tokenAmount.uiAmount > 0) // Only non-empty accounts
    .map(account => account.account.data.parsed.info.mint);

    } catch (err) {
        console.error(`❌ Error fetching tokens for ${wallet}: ${err.message}`);
        if (retries > 0) {
            console.log(`🔄 Retrying (${3 - retries} attempts left)...`);
            return getTokenAccounts(wallet, retries - 1);
        }
        return [];
    }
}

// 🔥 Generate Holders List
async function generateHoldersList() {
    const holders = {};

    for (const user of walletInfo) {
        console.log(`🔎 Checking tokens for wallet: ${user.walletAddress}...`);
        const tokens = await getTokenAccounts(user.walletAddress);

        // ✅ Filter tokens that match Solarians Mint List
        const matchingTokens = tokens.filter(token => solariansMintList.includes(token));

        if (matchingTokens.length > 0) {
            holders[user.walletAddress] = {
                discordId: user.discordId,
                twitterHandle: user.twitterHandle,
                tokens: matchingTokens
            };
            console.log(`✅ ${user.walletAddress} (${user.discordId}) holds ${matchingTokens.length} Solarians tokens.`);
        } else {
            console.log(`⚠️ ${user.walletAddress} (${user.discordId}) does not hold any Solarians tokens.`);
        }
    }

    // ✅ Ensure holders.json exists and is valid JSON before writing
    if (!fs.existsSync(holdersFilePath) || fs.readFileSync(holdersFilePath, 'utf8').trim() === '') {
        fs.writeFileSync(holdersFilePath, '{}');
    }

    // ✅ Save Holders Data to JSON File
    fs.writeFileSync(holdersFilePath, JSON.stringify(holders, null, 2));
    console.log(`🎉 Holders list successfully generated at ${holdersFilePath}`);
}

// 🚀 Run the Script
generateHoldersList();
