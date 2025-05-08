require('dotenv').config();
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const { Metaplex, guestIdentity } = require('@metaplex-foundation/js');

const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'), 'confirmed');
const metaplex = Metaplex.make(connection).use(guestIdentity());

const solariansList = require('../src/data/solarians-mintlist.json').solariansMintList || [];

(async () => {
  const metadata = {};
  const failed = [];

  for (const mint of solariansList) {
    try {
      const mintPubkey = new PublicKey(mint);
      const nft = await metaplex.nfts().findByMint({ mintAddress: mintPubkey });

      const uri = nft.uri;
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      metadata[mint] = {
        name: nft.name,
        symbol: nft.symbol,
        image: json.image,
        attributes: json.attributes,
        uri,
      };

      console.log(`✅ Fetched metadata for ${mint}`);
    } catch (err) {
      console.warn(`⚠️ Failed for ${mint}: ${err.message}`);
      failed.push(mint);
    }
  }

  fs.writeFileSync('./src/data/metadata.json', JSON.stringify(metadata, null, 2));
  fs.writeFileSync('./src/data/metadata-missing.json', JSON.stringify(failed, null, 2));
  console.log(`🎉 Saved metadata.json (${Object.keys(metadata).length} entries)`);
  console.log(`❌ Missing: ${failed.length} entries saved to metadata-missing.json`);
})();
