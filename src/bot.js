require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ✅ Define file paths for JSON data
const holdersFilePath = path.join(__dirname, 'data', 'holders.json');
const verifiedFilePath = path.join(__dirname, 'data', 'verified.json');

// ✅ Function to Check and Update Roles
async function updateRoles() {
    console.log(`🔄 Checking for updates in JSON files...`);

    // Fetch the Discord server (guild)
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    if (!guild) {
        console.error("❌ Guild not found!");
        return;
    }

    // Fetch roles from environment variables
    const holderRole = await guild.roles.fetch(process.env.HOLDER_ROLE_ID);
    if (!holderRole) {
        console.error("❌ Holder role not found!");
        return;
    }

    const verifiedRole = await guild.roles.fetch(process.env.ROLE_ID);
    if (!verifiedRole) {
        console.error("❌ Verified role not found!");
        return;
    }
    // Load holders.json
    let holders = {};
    try {
        if (fs.existsSync(holdersFilePath)) {
            const data = fs.readFileSync(holdersFilePath, 'utf8');
            holders = JSON.parse(data);
        } else {
            console.warn("⚠️ Holders file does not exist. No holder role updates will be applied.");
        }
    } catch (err) {
        console.error("❌ Error reading holders.json:", err);
        return;
    }

    // Load verified.json
    let verified = {};
    try {
        if (fs.existsSync(verifiedFilePath)) {
            const data = fs.readFileSync(verifiedFilePath, 'utf8');
            verified = JSON.parse(data);
        } else {
            console.warn("⚠️ Verified file does not exist. No verified role updates will be applied.");
        }
    } catch (err) {
        console.error("❌ Error reading verified.json:", err);
        return;
    }
    // Extract list of Discord IDs from each JSON file
    const holderDiscordIds = new Set(Object.values(holders).map(holder => holder.discordId));
    console.log("✅ Holder Discord IDs:", [...holderDiscordIds]);
    const verifiedDiscordIds = new Set(Object.values(verified).map(user => user.discordId));
    console.log("✅ Verified Discord IDs:", [...verifiedDiscordIds]);

    // Fetch all members in the guild
    const members = await guild.members.fetch();

    // Iterate through each member to update their roles
    for (const [userId, member] of members) {
        try {
            // ✅ Update Holder Role
            if (holderDiscordIds.has(userId)) {
                // Add the role if missing
                if (!member.roles.cache.has(holderRole.id)) {
                    await member.roles.add(holderRole);
                    console.log(`✅ Assigned holder role to ${member.user.tag}`);
                }
            } else {
                // Remove the role if present
                if (member.roles.cache.has(holderRole.id)) {
                    await member.roles.remove(holderRole);
                    console.log(`❌ Removed holder role from ${member.user.tag} (not in holders.json)`);
                }
            }
            // ✅ Update Verified Role
            if (verifiedDiscordIds.has(userId)) {
                // Add the role if missing
                if (!member.roles.cache.has(verifiedRole.id)) {
                    await member.roles.add(verifiedRole);
                    console.log(`✅ Assigned verified role to ${member.user.tag}`);
                }
            } else {
                // Remove the role if present
                if (member.roles.cache.has(verifiedRole.id)) {
                    await member.roles.remove(verifiedRole);
                    console.log(`❌ Removed verified role from ${member.user.tag} (not in verified.json)`);
                }
            }
        } catch (err) {
            console.error(`❌ Failed to update roles for ${member.user.tag}:`, err);
        }
    }
}

// ✅ Run updateRoles() when the bot is ready
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Run once immediately
    await updateRoles();

    // ✅ Run updateRoles() every X minutes (default to 5 minutes if ROLE_CHECK_INTERVAL is not set)
    const interval = process.env.ROLE_CHECK_INTERVAL || 300000;
    setInterval(updateRoles, interval);

    console.log(`⏳ Role updates will run every ${interval / 60000} minutes.`);
});

// Log the bot port (optional)
const botPort = process.env.BOT_PORT || 3000;
console.log(`🌐 Bot is running on port ${botPort}`);

// Log in to Discord
client.login(process.env.TOKEN);