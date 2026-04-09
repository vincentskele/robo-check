require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const {
  getAccountByDiscordId,
  buildVerifiedAccountIndex,
  readVerifiedEntries,
  normalizeDiscordId,
} = require('./accountStore');

// ----------------------
// Define Paths using process.cwd() so we work from your project root
// ----------------------
const dataDir = path.join(process.cwd(), 'src/data');
const holdersFile = path.join(dataDir, 'holders.json');
const solariansFile = path.join(dataDir, 'solarians-mintlist.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ----------------------
// Function: Load Solarians Mint List
// ----------------------
function loadSolariansMintList() {
  if (!fs.existsSync(solariansFile)) {
    console.error(`❌ Missing file: ${solariansFile}`);
    process.exit(1);
  }
  const solariansData = require(solariansFile);
  const solariansMintList = solariansData.solariansMintList || [];
  if (solariansMintList.length === 0) {
    console.error('❌ solariansMintList is empty!');
    process.exit(1);
  }
  return solariansMintList;
}

const solariansMintList = loadSolariansMintList();
console.log(`✅ Loaded ${solariansMintList.length} solarian mint(s)`);

// ----------------------
// Setup Solana Connection
// ----------------------
const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
const connection = new Connection(rpcUrl, 'processed');

// ----------------------
// Function: Get Token Accounts for a Wallet
// ----------------------
async function getTokenAccounts(wallet, retries = 3) {
  try {
    const pubkey = new PublicKey(wallet);
    // Request a 0-lamport airdrop to force fresh data (ignoring any errors)
    await connection.requestAirdrop(pubkey, 0).catch(() => {});
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
      'processed'
    );
    return tokenAccounts.value
      .filter(acc => acc.account.data.parsed.info.tokenAmount.uiAmount > 0)
      .map(acc => acc.account.data.parsed.info.mint);
  } catch (err) {
    console.error(`❌ Error fetching tokens for wallet ${wallet}: ${err.message}`);
    if (retries > 0) {
      console.log(`🔄 Retrying (${retries} attempt(s) left)...`);
      return getTokenAccounts(wallet, retries - 1);
    }
    return [];
  }
}
// Get metadata (read-only)
const { Metaplex, guestIdentity } = require('@metaplex-foundation/js');

// Set up Metaplex with guest (read-only) access
const metaplex = Metaplex.make(connection).use(guestIdentity());

async function getNftMetadata(mintAddress) {
  try {
    const nft = await metaplex.nfts().findByMint({ mintAddress: new PublicKey(mintAddress) });
    return {
      name: nft.name,
      symbol: nft.symbol,
      image: nft.json?.image,
      attributes: nft.json?.attributes,
      uri: nft.uri,
    };
  } catch (err) {
    console.error(`❌ Failed to get metadata for ${mintAddress}: ${err.message}`);
    return null;
  }
}



// ----------------------
// Function: Generate Holders List
// ----------------------
async function generateHoldersList() {
  console.log(`🔄 Running generateHoldersList at ${new Date().toLocaleString()}`);

  const verifiedEntries = readVerifiedEntries();
  const accounts = [...buildVerifiedAccountIndex(verifiedEntries).values()];
  console.log(`✅ Loaded ${verifiedEntries.length} verified entr${verifiedEntries.length === 1 ? 'y' : 'ies'} across ${accounts.length} account(s)`);

  const holders = [];

  const metadataMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'metadata.json'), 'utf8'));

  for (const account of accounts) {
    const discordId = normalizeDiscordId(account.discordId);
    const walletList = Array.isArray(account.wallets) ? account.wallets : [];
    const tokenMap = new Map();

    console.log(`🔎 Checking ${walletList.length} wallet(s) for Discord ID ${discordId}`);

    for (const wallet of walletList) {
      console.log(`   ↳ Wallet: ${wallet.walletAddress}`);
      const tokens = await getTokenAccounts(wallet.walletAddress);
      const matchingTokens = tokens.filter(token => solariansMintList.includes(token));
      matchingTokens.forEach((mint) => {
        if (!tokenMap.has(mint)) {
          tokenMap.set(mint, {
            mint,
            metadata: metadataMap[mint] || null,
          });
        }
      });
    }

    if (tokenMap.size > 0) {
      const latestAccount = getAccountByDiscordId(discordId, verifiedEntries) || account;
      holders.push({
        walletAddress: latestAccount.primaryWalletAddress || latestAccount.walletAddress || null,
        primaryWalletAddress: latestAccount.primaryWalletAddress || latestAccount.walletAddress || null,
        wallets: walletList,
        discordId,
        twitterHandle: latestAccount.twitterHandle || null,
        tokens: [...tokenMap.values()],
      });

      console.log(`✅ Discord ID ${discordId} holds ${tokenMap.size} solarian token(s) across ${walletList.length} wallet(s).`);
    } else {
      console.log(`⚠️ Discord ID ${discordId} holds no solarian tokens across linked wallets.`);
    }
  }

  try {
    fs.writeFileSync(holdersFile, JSON.stringify(holders, null, 2));
    console.log(`🎉 Holders list updated at ${new Date().toLocaleString()}`);
    console.log(`📝 File written to: ${holdersFile}`);
  } catch (err) {
    console.error(`❌ Failed to write holders file: ${err.message}`);
  }
}


// ----------------------
// Run Immediately & Set Interval
// ----------------------
const intervalMs = process.env.GENERATE_HOLDERS_INTERVAL
  ? parseInt(process.env.GENERATE_HOLDERS_INTERVAL)
  : 900000; // Default: 15 minutes

generateHoldersList();
setInterval(generateHoldersList, intervalMs);
console.log(`⏳ generateHolders.js will run every ${intervalMs / 60000} minute(s).`);
