require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// === Load and Validate Environment Variables ===
const API_BASE_URL = process.env.API_BASE_URL?.trim() || "http://localhost:3000";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL?.trim() || "ws://localhost:4000";
const REQUIRED_ENV_VARS = ["TOKEN", "CLIENT_ID", "GUILD_ID", "HOLDER_ROLE_ID", "ROLE_ID"];

REQUIRED_ENV_VARS.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ ERROR: Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

// === Initialize Bot ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// === Debugging Logs ===
console.log(`🌎 API_BASE_URL: ${API_BASE_URL}`);
console.log(`🔗 WEBSOCKET_URL: ${WEBSOCKET_URL}`);

// === Define File Paths for Data Storage ===
const holdersFilePath = path.join(__dirname, 'data', 'holders.json');
const verifiedFilePath = path.join(__dirname, 'data', 'verified.json');

// === Register Slash Commands on Startup ===
const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start the verification process')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🔄 Refreshing application (/) commands...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered successfully!");
  } catch (error) {
    console.error("❌ Error registering commands:", error);
  }
})();

// === Function to Check and Update Roles ===
async function updateRoles() {
  console.log("🔄 Checking for role updates...");

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  if (!guild) {
    console.error("❌ Guild not found!");
    return;
  }

  const holderRole = await guild.roles.fetch(process.env.HOLDER_ROLE_ID);
  const verifiedRole = await guild.roles.fetch(process.env.ROLE_ID);

  if (!holderRole || !verifiedRole) {
    console.error("❌ One or more roles not found!");
    return;
  }

  let holders = {}, verified = {};
  try {
    if (fs.existsSync(holdersFilePath)) {
      holders = JSON.parse(fs.readFileSync(holdersFilePath, 'utf8'));
    }
    if (fs.existsSync(verifiedFilePath)) {
      verified = JSON.parse(fs.readFileSync(verifiedFilePath, 'utf8'));
    }
  } catch (err) {
    console.error("❌ Error reading JSON files:", err);
    return;
  }

  const holderDiscordIds = new Set(Object.values(holders).map(h => h.discordId));
  const verifiedDiscordIds = new Set(Object.values(verified).map(v => v.discordId));

  console.log(`✅ Holders: ${holderDiscordIds.size}, Verified: ${verifiedDiscordIds.size}`);

  // Fetch all guild members and update roles
  const members = await guild.members.fetch();
  for (const [userId, member] of members) {
    try {
      // Update Holder Role
      if (holderDiscordIds.has(userId) && !member.roles.cache.has(holderRole.id)) {
        await member.roles.add(holderRole);
        console.log(`✅ Assigned holder role to ${member.user.tag}`);
      } else if (!holderDiscordIds.has(userId) && member.roles.cache.has(holderRole.id)) {
        await member.roles.remove(holderRole);
        console.log(`❌ Removed holder role from ${member.user.tag}`);
      }

      // Update Verified Role
      if (verifiedDiscordIds.has(userId) && !member.roles.cache.has(verifiedRole.id)) {
        await member.roles.add(verifiedRole);
        console.log(`✅ Assigned verified role to ${member.user.tag}`);
      } else if (!verifiedDiscordIds.has(userId) && member.roles.cache.has(verifiedRole.id)) {
        await member.roles.remove(verifiedRole);
        console.log(`❌ Removed verified role from ${member.user.tag}`);
      }
    } catch (err) {
      console.error(`❌ Failed to update roles for ${member.user.tag}:`, err);
    }
  }
}

// === WebSocket Integration for Verification Confirmation ===
let ws;

function connectWebSocket() {
  ws = new WebSocket(WEBSOCKET_URL);

  ws.on('open', () => {
    console.log("🔗 Connected to WebSocket for verification updates.");
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.status === "confirmed" && message.discordId) {
        console.log(`✅ Verification confirmed for Discord ID: ${message.discordId}`);

        const user = await client.users.fetch(message.discordId);
        if (user) {
          await user.send(`🎉 **You have been successfully verified!**\n` +
            `✅ Your wallet \`${message.walletAddress}\` is now linked.\n` +
            `🔗 **Transaction ID:** \`${message.txId}\`\n`);

          console.log(`📩 Confirmation message sent to ${user.tag}`);
        }
      }
    } catch (error) {
      console.error("❌ Error handling WebSocket message:", error);
    }
  });

  ws.on('close', () => {
    console.warn("⚠️ WebSocket connection closed. Reconnecting in 5 seconds...");
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    console.error("❌ WebSocket error:", error);
  });
}

// === When the Bot is Ready ===
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Initial role check
  await updateRoles();

  // Schedule role updates at intervals
  const interval = process.env.ROLE_CHECK_INTERVAL || 300000; // default 5 minutes
  setInterval(updateRoles, interval);
  console.log(`⏳ Role updates will run every ${interval / 60000} minutes.`);

  // Connect WebSocket for verification confirmations
  connectWebSocket();
});

// === Load Interaction Handler ===
const interactionCreateHandler = require('./events/interactionCreate.js');
client.on('interactionCreate', (interaction) => interactionCreateHandler(interaction, client));

// === Log in to Discord ===
client.login(process.env.TOKEN);
