// listener.js

const path = require('path'); // Ensure path is loaded first
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Load .env explicitly

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const express = require('express');
const fs = require('fs');

// Ensure required environment variables exist
if (!process.env.LISTENER_PORT || !process.env.RECEIVING_ADDRESS || !process.env.SOLANA_RPC_URL) {
  console.error("❌ ERROR: Missing required environment variables in .env file.");
  process.exit(1);
}

// Load environment variables
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const RECEIVING_ADDRESS = new PublicKey(process.env.RECEIVING_ADDRESS);
const LISTENER_PORT = process.env.LISTENER_PORT || 4000;
const POLL_INTERVAL = parseInt(process.env.SOLANA_POLL_INTERVAL) || 10000;

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Paths to JSON storage
const dataDir = path.join(__dirname, '/data');
const tokensFile = path.join(dataDir, 'tokens.json');
const verifiedFile = path.join(dataDir, 'verified.json');

// Ensure the `data/` directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Function to ensure JSON files exist
const ensureFileExists = (filePath, defaultValue = []) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
};

// Initialize JSON files if missing
ensureFileExists(tokensFile);
ensureFileExists(verifiedFile);

// Function to read JSON files safely
const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error);
    return [];
  }
};

// Function to write JSON files safely
const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`❌ Error writing to ${filePath}:`, error);
  }
};

// To avoid processing the same transaction more than once, store processed signatures in a Set
const processedSignatures = new Set();

// Function to check for new transactions on the receiving address
const checkForTransactions = async () => {
  try {
    // Fetch recent transaction signatures for the receiving address
    const signatures = await connection.getSignaturesForAddress(RECEIVING_ADDRESS, { limit: 10 });
    if (!signatures || signatures.length === 0) {
      return;
    }

    // Read pending tokens and verified entries from file
    let tokens = readJson(tokensFile);
    let verified = readJson(verifiedFile);
    const now = Date.now();
    let tokensModified = false;

    // Process each new transaction signature
    for (const sigInfo of signatures) {
      const signature = sigInfo.signature;
      if (processedSignatures.has(signature)) continue; // Skip if already processed

      // Get the parsed transaction details with the required config parameter
      const txn = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (!txn) continue;

      // Look through all instructions in the transaction
      const instructions = txn.transaction.message.instructions;
      for (const ix of instructions) {
        // We are only interested in System Program transfers
        if (ix.program === 'system' && ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;
          // Confirm the destination matches our receiving address
          if (info.destination !== RECEIVING_ADDRESS.toBase58()) continue;

          // Retrieve the transfer amount in lamports
          const lamportsTransferred = info.lamports;

          // Iterate through pending tokens looking for a match
          tokens = tokens.filter(token => {
            // Skip tokens already verified or expired
            if (token.verified || token.expiresAt < now) return true;
            // If the token defines a receivingAddress, ensure it matches our global address
            if (token.receivingAddress && token.receivingAddress !== RECEIVING_ADDRESS.toBase58()) return true;
            // Check that the sender (source) matches the token's walletAddress
            if (info.source !== token.walletAddress) return true;

            // Convert expected SOL amount (as string) to lamports
            const expectedLamports = Math.round(parseFloat(token.amount) * LAMPORTS_PER_SOL);

            // Verify that the transferred lamports exactly match the expected amount
            if (lamportsTransferred === expectedLamports) {
              token.verified = true;
              token.verifiedAt = now;
              console.log(`✅ Payment verified for Discord ID: ${token.discordId} (Tx: ${signature})`);
              verified.push(token);
              tokensModified = true;
              // Remove this token from pending tokens (by filtering it out)
              return false;
            }
            return true;
          });
        }
      }
      // Mark the transaction signature as processed
      processedSignatures.add(signature);
    }

    // Write any updates back to file if tokens have been modified
    if (tokensModified) {
      writeJson(tokensFile, tokens);
      writeJson(verifiedFile, verified);
    }
  } catch (error) {
    console.error("❌ Error checking transactions:", error);
  }
};

// Run the transaction check every POLL_INTERVAL milliseconds
setInterval(checkForTransactions, POLL_INTERVAL);

// Start Express API for listener monitoring
const app = express();

app.get('/status', (req, res) => {
  res.json({ message: "Listener is running and monitoring transactions." });
});

app.listen(LISTENER_PORT, () => {
  console.log(`📡 Listener API running on http://localhost:${LISTENER_PORT}`);
});

console.log(`🔍 Listener started: Watching ${RECEIVING_ADDRESS.toBase58()} for incoming SOL payments...`);
console.log(`⏳ Polling every ${POLL_INTERVAL / 1000} seconds.`);
