require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder 
} = require('discord.js');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ✅ Ensure API_BASE_URL Defaults Correctly
const API_BASE_URL = process.env.API_BASE_URL?.trim() || "http://localhost:3000";
const WS_URL = process.env.WS_URL?.trim() || "ws://localhost:4000";

// ✅ Validate Environment Variables
const REQUIRED_ENV_VARS = ["TOKEN", "CLIENT_ID", "GUILD_ID"];
REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
        console.error(`❌ ERROR: Missing required environment variable: ${varName}`);
        process.exit(1);
    }
});

// ✅ Initialize Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ✅ Define File Paths for JSON Data
const holdersFilePath = path.join(__dirname, 'data', 'holders.json');
const verifiedFilePath = path.join(__dirname, 'data', 'verified.json');

// ✅ Slash Commands Setup
const commands = [
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Start the verification process')
].map(command => command.toJSON());

// ✅ Deploy Commands on Bot Startup
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

// ✅ Function to Check and Update Roles
async function updateRoles() {
    console.log(`🔄 Checking for updates in JSON files...`);

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
        if (fs.existsSync(holdersFilePath)) holders = JSON.parse(fs.readFileSync(holdersFilePath, 'utf8'));
        if (fs.existsSync(verifiedFilePath)) verified = JSON.parse(fs.readFileSync(verifiedFilePath, 'utf8'));
    } catch (err) {
        console.error("❌ Error reading JSON files:", err);
        return;
    }

    const holderDiscordIds = new Set(Object.values(holders).map(holder => holder.discordId));
    const verifiedDiscordIds = new Set(Object.values(verified).map(user => user.discordId));

    console.log("✅ Holder IDs:", [...holderDiscordIds]);
    console.log("✅ Verified IDs:", [...verifiedDiscordIds]);

    const members = await guild.members.fetch();

    for (const [userId, member] of members) {
        try {
            if (holderDiscordIds.has(userId) && !member.roles.cache.has(holderRole.id)) {
                await member.roles.add(holderRole);
                console.log(`✅ Assigned holder role to ${member.user.tag}`);
            } else if (!holderDiscordIds.has(userId) && member.roles.cache.has(holderRole.id)) {
                await member.roles.remove(holderRole);
                console.log(`❌ Removed holder role from ${member.user.tag}`);
            }

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

// ✅ Run updateRoles() When the Bot is Ready
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    await updateRoles();

    const interval = process.env.ROLE_CHECK_INTERVAL || 300000;
    setInterval(updateRoles, interval);
    console.log(`⏳ Role updates will run every ${interval / 60000} minutes.`);
});

// ✅ Listen for Slash Commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    console.log(`🔄 Command received: ${interaction.commandName}`);

    if (interaction.commandName === 'verify') {
        console.log("✅ /verify command triggered!");

        const modal = new ModalBuilder()
            .setCustomId('verificationModal')
            .setTitle('Verification Form');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('twitter')
                    .setLabel('Twitter Handle (without @)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('wallet')
                    .setLabel('Solana Wallet Address')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        try {
            await interaction.showModal(modal);
            console.log("✅ Modal displayed successfully!");
        } catch (error) {
            console.error("❌ Error displaying modal:", error);
        }
    }
});



// ✅ Handle Modal Submission
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId === 'verificationModal') {
        console.log("✅ Modal submission received!");

        const discordId = interaction.user.id;
        const twitterHandle = interaction.fields.getTextInputValue('twitter');
        const walletAddress = interaction.fields.getTextInputValue('wallet');

        console.log(`📡 Sending verification request to ${API_BASE_URL}/payment-request`);

        try {
            // ✅ Defer reply immediately to avoid timeout issues
            await interaction.deferReply({ ephemeral: true });

            // Send data to the API
            const response = await fetch(`${API_BASE_URL}/payment-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discordId, twitterHandle, walletAddress })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log("✅ Received API response:", data);

            // ✅ Update the deferred reply with the payment instructions
            await interaction.editReply({
                content: `✅ **Verification request received!**\n\n📌 **Amount:** ${data.amount} SOL\n📩 **Send to:** ${data.receivingAddress}`
            });

        } catch (error) {
            console.error("❌ Verification error:", error);
            await interaction.editReply({ content: '❌ Error during verification.' });
        }
    }
});


// ✅ Handle Payment Confirmations via WebSocket
const ws = new WebSocket(WS_URL);

ws.on('open', () => console.log("✅ Connected to WebSocket for payment confirmations."));

ws.on('message', async (msg) => {
    try {
        const data = JSON.parse(msg);

        if (data.status === "confirmed" && data.discordId) {
            console.log(`✅ Payment confirmed for Discord ID: ${data.discordId}`);

            // Fetch the user from Discord
            const user = await client.users.fetch(data.discordId).catch(() => null);
            if (!user) {
                console.error(`❌ Could not find user with ID: ${data.discordId}`);
                return;
            }

            // ✅ Send the confirmation as a private message (DM)
            await user.send(`✅ **Payment Confirmed!**\nYour **${data.amount} SOL** has been successfully received! 🎉`).catch(() => {
                console.error(`❌ Failed to send DM to ${user.tag}.`);
            });

            console.log(`📩 Sent confirmation DM to ${user.tag}`);
        }
    } catch (error) {
        console.error("❌ WebSocket Message Error:", error);
    }
});

ws.on('close', () => console.log("❌ WebSocket connection closed."));
ws.on('error', (error) => console.error("❌ WebSocket Error:", error));

// ✅ Log in to Discord
client.login(process.env.TOKEN);
