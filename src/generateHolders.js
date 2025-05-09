/**
 * generateHolders.js
 * -----------------------------------------------------------
 * Creates src/data/holders.json – now enriched with „feesPaid“
 *
 *  • Reads the verified wallet list (verified.json)
 *  • Checks which wallets hold Solarian mints
 *  • Adds metadata from metadata.json
 *  • NEW: calls Helius once per mint to see if the most‑recent
 *         transfer is an NFT sale (=> royalties/fees paid)
 *
 * Runs immediately and then every GENERATE_HOLDERS_INTERVAL ms
 * (default 900 000 = 15 min).
 */

require('dotenv').config();
const FEE_RPC = process.env.FEE_RPC || 'https://api.helius.xyz';

const fs         = require('fs');
const path       = require('path');
const fetch      = require('node-fetch');
const {
  Connection,
  clusterApiUrl,
  PublicKey
} = require('@solana/web3.js');
const {
  Metaplex,
  guestIdentity
} = require('@metaplex-foundation/js');

/*──────────────────────────────────────────────────────────────
  CONFIG & PATHS
  ─────────────────────────────────────────────────────────────*/
const dataDir        = path.join(process.cwd(), 'src/data');
const holdersFile    = path.join(dataDir, 'holders.json');
const verifiedFile   = path.join(dataDir, 'verified.json');
const solariansFile  = path.join(dataDir, 'solarians-mintlist.json');
const metadataFile   = path.join(dataDir, 'metadata.json');

/* Ensure data dir exists */
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/*──────────────────────────────────────────────────────────────
  HELIUS API KEY  (hard‑code or keep in .env as HELIUS_KEY)
  ─────────────────────────────────────────────────────────────*/
const HELIUS_KEY = process.env.HELIUS_KEY || 'YOUR-HELIUS-KEY-GOES-HERE';
if (!HELIUS_KEY) {
  console.error('❌  Missing Helius API key (set HELIUS_KEY or hard‑code).');
  process.exit(1);
}

/*──────────────────────────────────────────────────────────────
  LOAD STATIC DATA
  ─────────────────────────────────────────────────────────────*/
function loadSolariansMintList() {
  if (!fs.existsSync(solariansFile)) {
    console.error(`❌ Missing ${solariansFile}`);
    process.exit(1);
  }
  const raw = require(solariansFile);
  /* accept either bare array or wrapped array */
  return Array.isArray(raw) ? raw : Object.values(raw).find(Array.isArray) || [];
}

const solariansMintList = loadSolariansMintList();
console.log(`✅ Loaded ${solariansMintList.length} Solarian mints`);

const metadataMap = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));

/*──────────────────────────────────────────────────────────────
  SOLANA RPC & METAPLEX
  ─────────────────────────────────────────────────────────────*/
const rpcUrl     = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
const connection = new Connection(rpcUrl, 'processed');
const metaplex   = Metaplex.make(connection).use(guestIdentity());

/*──────────────────────────────────────────────────────────────
  HELIUS helper: was the most‑recent tx an NFT sale?
  ─────────────────────────────────────────────────────────────*/
  const heliusURL = (mint) =>
    `${FEE_RPC}/v0/addresses/${mint}/transactions?api-key=${HELIUS_KEY}&limit=1`;
  
async function feesPaidForMint(mint) {
  try {
    const [tx] = await fetch(heliusURL(mint)).then((r) => r.json());
    if (!tx) return false;
    if (tx.type?.startsWith('NFT_') && tx.type !== 'NFT_LISTING') return true;
    if (tx.events?.nft?.type?.includes('NFT_SALE'))               return true;
    return false;
  } catch (e) {
    console.error(`⚠️  Helius error for ${mint}: ${e.message}`);
    return false;
  }
}

/*──────────────────────────────────────────────────────────────
  WALLET HELPERS
  ─────────────────────────────────────────────────────────────*/
function loadVerifiedUsers() {
  if (!fs.existsSync(verifiedFile)) {
    console.error(`❌ Missing ${verifiedFile}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(verifiedFile, 'utf8'));
}

async function getTokenAccounts(wallet, retries = 3) {
  try {
    const pubkey        = new PublicKey(wallet);
    await connection.requestAirdrop(pubkey, 0).catch(() => {});
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
      'processed'
    );
    return tokenAccounts.value
      .filter(({ account }) => account.data.parsed.info.tokenAmount.uiAmount > 0)
      .map(({ account }) => account.data.parsed.info.mint);
  } catch (err) {
    if (retries > 0) {
      console.log(`🔄 RPC retry (${retries}) for ${wallet}`);
      return getTokenAccounts(wallet, retries - 1);
    }
    console.error(`❌ Token fetch failed for ${wallet}: ${err.message}`);
    return [];
  }
}

/*──────────────────────────────────────────────────────────────
  MAIN: generateHoldersList
  ─────────────────────────────────────────────────────────────*/
async function generateHoldersList() {
  console.log(`🔄 generateHoldersList @ ${new Date().toLocaleString()}`);

  const verifiedUsers = loadVerifiedUsers().filter(u => u.verified);
  const holders       = [];

  for (const user of verifiedUsers) {
    const { walletAddress } = user;
    console.log(`🔎 Wallet ${walletAddress}`);
    const tokens          = await getTokenAccounts(walletAddress);
    const solarianMints   = tokens.filter(m => solariansMintList.includes(m));

    if (solarianMints.length === 0) {
      console.log(`⚠️  No Solarian tokens`);
      continue;
    }

    /* Build token list with metadata + feesPaid */
    const tokenMetadataList = [];
    for (const mint of solarianMints) {
      const feesPaid = await feesPaidForMint(mint);
      tokenMetadataList.push({
        mint,
        metadata : metadataMap[mint] || null,
        feesPaid
      });
    }

    holders.push({
      walletAddress,
      discordId    : user.discordId,
      twitterHandle: user.twitterHandle || null,
      tokens       : tokenMetadataList
    });

    console.log(`✅  ${solarianMints.length} tokens (fees checked)`);
  }

  fs.writeFileSync(holdersFile, JSON.stringify(holders, null, 2));
  console.log(`🎉 Holders list written → ${holdersFile}`);
}

/*──────────────────────────────────────────────────────────────
  SCHEDULER
  ─────────────────────────────────────────────────────────────*/
const intervalMs = parseInt(process.env.GENERATE_HOLDERS_INTERVAL || '900000', 10);

generateHoldersList();
setInterval(generateHoldersList, intervalMs);
console.log(`⏳ generateHoldersList runs every ${intervalMs / 60000} min`);
