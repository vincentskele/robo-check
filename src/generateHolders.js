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
const solariansMintList = require(solariansMintListFilePath).solariansMintList;

// ✅ Setup Solana Connection
const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

// ✅ Load Verified Users & Extract Wallet Addresses
if (!fs.existsSync(verifiedFilePath)) {
    console.error(`❌ Error: Missing ${verifiedFilePath}`);
    process.exit(1);
}
const verifiedData = JSON.parse(fs.readFileSync(verifiedFilePath, 'utf8'));
const walletAddresses = verifiedData
    .filter(user => user.verified) // Only verified users
    .map(user => user.walletAddress); // Extract wallet addresses

console.log("✅ Found Wallet Addresses:", walletAddresses);

// 🔍 Function to Fetch Token Holdings for a Wallet
async function getTokenAccounts(wallet) {
    try {
        const publicKey = new PublicKey(wallet);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') // SPL Token Program ID
        });

        // Extract token mints
        return tokenAccounts.value.map(account => account.account.data.parsed.info.mint);
    } catch (err) {
        console.error(`❌ Error fetching tokens for ${wallet}:`, err);
        return [];
    }
}

// 🔥 Generate Holders List
async function generateHoldersList() {
    const holders = {};

    for (const wallet of walletAddresses) {
        console.log(`🔎 Checking tokens for wallet: ${wallet}...`);
        const tokens = await getTokenAccounts(wallet);

        // ✅ Filter tokens that match Solarians Mint List
        const matchingTokens = tokens.filter(token => solariansMintList.includes(token));

        if (matchingTokens.length > 0) {
            holders[wallet] = matchingTokens;
            console.log(`✅ ${wallet} holds ${matchingTokens.length} Solarians tokens.`);
        } else {
            console.log(`⚠️ ${wallet} does not hold any Solarians tokens.`);
        }
    }

    // ✅ Ensure holders.json exists before writing
    if (!fs.existsSync(holdersFilePath)) {
        fs.writeFileSync(holdersFilePath, '{}');
    }

    // ✅ Save Holders Data to JSON File
    fs.writeFileSync(holdersFilePath, JSON.stringify(holders, null, 2));
    console.log(`🎉 Holders list successfully generated at ${holdersFilePath}`);
}

// 🚀 Run the Script
generateHoldersList();
