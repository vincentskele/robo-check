const path = require('path'); // Ensure path is loaded first
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Load .env explicitly

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const express = require('express');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws'); // Import WebSocket

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

// Initialize JSON files if missing
const ensureFileExists = (filePath, defaultValue = []) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
};

ensureFileExists(tokensFile);
ensureFileExists(verifiedFile);

// Read & Write JSON helper functions
const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error);
    return [];
  }
};

const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`❌ Error writing to ${filePath}:`, error);
  }
};

// Keep track of processed transaction signatures (avoid re-checking)
const processedSignatures = new Set();

// === Express & WebSocket Setup ===
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Broadcast function to notify connected clients of a confirmed payment
const broadcastPaymentConfirmed = (paymentData) => {
  // paymentData might include: { discordId, amount, walletAddress, verifiedAt, txId }
  const message = JSON.stringify({ status: "confirmed", ...paymentData });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// === Transaction Checking Logic ===
const checkForTransactions = async () => {
  try {
    // Get the most recent 10 signatures for the receiving address
    const signatures = await connection.getSignaturesForAddress(RECEIVING_ADDRESS, { limit: 10 });
    if (!signatures || signatures.length === 0) return;

    let tokens = readJson(tokensFile);
    let verified = readJson(verifiedFile);
    const now = Date.now();
    let tokensModified = false;

    // Loop over each signature from newest to oldest
    for (const sigInfo of signatures) {
      const signature = sigInfo.signature;

      // If we've already processed this signature, skip
      if (processedSignatures.has(signature)) continue;

      // Get the actual transaction
      const txn = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (!txn) continue;

      // Inspect instructions for a system transfer into RECEIVING_ADDRESS
      const instructions = txn.transaction.message.instructions;
      for (const ix of instructions) {
        if (ix.program === 'system' && ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;

          // If it's not transferred to our listening address, skip
          if (info.destination !== RECEIVING_ADDRESS.toBase58()) continue;

          const lamportsTransferred = info.lamports;

          // Check if any unverified token request matches this transaction
          tokens = tokens.filter(token => {
            // If it's already verified or expired, keep it in array
            if (token.verified || token.expiresAt < now) return true;
            // If the receiving address is different, skip
            if (token.receivingAddress && token.receivingAddress !== RECEIVING_ADDRESS.toBase58()) return true;
            // If the source wallet doesn't match, skip
            if (info.source !== token.walletAddress) return true;

            // Compare lamports
            const expectedLamports = Math.round(parseFloat(token.amount) * LAMPORTS_PER_SOL);
            if (lamportsTransferred === expectedLamports) {
              // Mark as verified
              token.verified = true;
              token.verifiedAt = now;

              console.log(`✅ Payment verified for Discord ID: ${token.discordId} (Tx: ${signature})`);

              // Add token to verified.json
              verified.push(token);
              tokensModified = true;

              // Broadcast confirmation to WebSocket clients
              broadcastPaymentConfirmed({
                discordId: token.discordId,
                amount: token.amount,
                walletAddress: token.walletAddress,
                verifiedAt: new Date(now).toISOString(),
                txId: signature  // <-- Now we include the Tx ID
              });

              // Remove it from the tokens array (already verified)
              return false;
            }
            return true;
          });
        }
      }
      // Mark this signature as processed
      processedSignatures.add(signature);
    }

    // If we modified tokens, save them
    if (tokensModified) {
      writeJson(tokensFile, tokens);
      writeJson(verifiedFile, verified);
    }
  } catch (error) {
    console.error("❌ Error checking transactions:", error);
  }
};

// === Poll the network at intervals for new transactions
setInterval(checkForTransactions, POLL_INTERVAL);

// === Basic Express API Endpoint
app.get('/status', (req, res) => {
  res.json({ message: "Listener is running and monitoring transactions." });
});

// === Start Express & WebSocket Server
server.listen(LISTENER_PORT, () => {
  console.log(`📡 Listener API running on http://localhost:${LISTENER_PORT}`);
});

console.log(`🔍 Listener started: Watching ${RECEIVING_ADDRESS.toBase58()} for incoming SOL payments...`);
console.log(`⏳ Polling every ${POLL_INTERVAL / 1000} seconds.`);
