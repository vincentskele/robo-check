require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');

// ----------------------
// Define Paths using process.cwd() so we work from your project root
// ----------------------
const dataDir = path.join(process.cwd(), 'src/data');
const holdersFile = path.join(dataDir, 'holders.json');
const verifiedFile = path.join(dataDir, 'verified.json');
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
// Function: Load Verified Users Each Cycle
// ----------------------
function loadVerifiedUsers() {
  if (!fs.existsSync(verifiedFile)) {
    console.error(`❌ Missing file: ${verifiedFile}`);
    process.exit(1);
  }
  try {
    const verifiedUsers = JSON.parse(fs.readFileSync(verifiedFile, 'utf8'));
    console.log(`✅ Loaded ${verifiedUsers.length} verified user(s) from ${verifiedFile}`);
    return verifiedUsers;
  } catch (err) {
    console.error(`❌ Failed to parse verified file: ${err.message}`);
    process.exit(1);
  }
}

function normalizeDiscordId(discordId) {
  return String(discordId || '').trim();
}

function normalizeWalletAddress(walletAddress) {
  return String(walletAddress || '').trim().toLowerCase();
}

function getActiveVerifiedUsers(verifiedUsers) {
  const latestByDiscordId = new Map();

  (Array.isArray(verifiedUsers) ? verifiedUsers : []).forEach((user, index) => {
    if (!user?.verified) return;

    const discordId = normalizeDiscordId(user.discordId);
    const walletAddress = String(user.walletAddress || '').trim();
    if (!discordId || !walletAddress) return;

    const existing = latestByDiscordId.get(discordId);
    const existingVerifiedAt = Number(existing?.verifiedAt) || 0;
    const nextVerifiedAt = Number(user.verifiedAt) || 0;

    if (
      !existing ||
      nextVerifiedAt > existingVerifiedAt ||
      (nextVerifiedAt === existingVerifiedAt && index > existing.index)
    ) {
      latestByDiscordId.set(discordId, {
        ...user,
        discordId,
        walletAddress,
        twitterHandle: user.twitterHandle || null,
        index,
      });
    }
  });

  const activeUsers = [...latestByDiscordId.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ index, ...user }) => user);

  const duplicateCount = (Array.isArray(verifiedUsers) ? verifiedUsers : []).filter((user) => user?.verified).length - activeUsers.length;
  if (duplicateCount > 0) {
    console.log(`ℹ️ Ignoring ${duplicateCount} superseded verified entr${duplicateCount === 1 ? 'y' : 'ies'} when generating holders.json`);
  }

  return activeUsers;
}

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

  const verifiedUsers = getActiveVerifiedUsers(loadVerifiedUsers());
  const walletInfo = verifiedUsers
    .map(user => ({
      walletAddress: user.walletAddress,
      discordId: user.discordId,
      twitterHandle: user.twitterHandle || null,
    }));

  console.log("✅ Found Wallets:", walletInfo.map(u => u.walletAddress));

  const holders = [];

  const metadataMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'metadata.json'), 'utf8'));

  for (const user of walletInfo) {
    console.log(`🔎 Checking wallet: ${user.walletAddress}`);
    const tokens = await getTokenAccounts(user.walletAddress);
    const matchingTokens = tokens.filter(token => solariansMintList.includes(token));

    if (matchingTokens.length > 0) {
      const tokenMetadataList = matchingTokens.map(mint => ({
        mint,
        metadata: metadataMap[mint] || null
      }));

      holders.push({
        walletAddress: user.walletAddress,
        discordId: user.discordId,
        twitterHandle: user.twitterHandle,
        tokens: tokenMetadataList,
      });

      console.log(`✅ ${user.walletAddress} holds ${tokenMetadataList.length} solarian token(s).`);
    } else {
      console.log(`⚠️ ${user.walletAddress} holds no solarian tokens.`);
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
