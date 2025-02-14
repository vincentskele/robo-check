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

// ✅ Define Paths
const holdersFilePath = path.join(__dirname, 'data', 'holders.json');

// ✅ Function to Check and Update Roles
async function updateRoles() {
    console.log(`🔄 Checking ${holdersFilePath} for updates...`);

    // Fetch the Discord server (guild)
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    if (!guild) {
        console.error("❌ Guild not found!");
        return;
    }

    // Fetch role from environment variables
    const holderRole = await guild.roles.fetch(process.env.HOLDER_ROLE_ID);
    if (!holderRole) {
        console.error("❌ Holder role not found!");
        return;
    }

    // Load holders from JSON
    let holders = {};
    try {
        if (fs.existsSync(holdersFilePath)) {
            const data = fs.readFileSync(holdersFilePath, 'utf8');
            holders = JSON.parse(data);
        } else {
            console.warn("⚠️ Holders file does not exist. No roles will be updated.");
        }
    } catch (err) {
        console.error("❌ Error reading holders.json:", err);
        return;
    }

    // Extract list of holders' Discord IDs
    const verifiedHolders = new Set(
        Object.values(holders).map(holder => holder.discordId)
    );
    console.log("✅ Verified Holders:", [...verifiedHolders]);

    // Fetch all members in the guild
    const members = await guild.members.fetch();

    // ✅ Assign the holder role to verified holders
    for (const [userId, member] of members) {
        try {
            if (verifiedHolders.has(userId)) {
                // Add the role if the user is in holders.json but doesn't have the role yet
                if (!member.roles.cache.has(holderRole.id)) {
                    await member.roles.add(holderRole);
                    console.log(`✅ Assigned holder role to ${member.user.tag}`);
                }
            } else {
                // Remove the role if the user is NOT in holders.json but has the role
                if (member.roles.cache.has(holderRole.id)) {
                    await member.roles.remove(holderRole);
                    console.log(`❌ Removed holder role from ${member.user.tag} (no longer in holders.json)`);
                }
            }
        } catch (err) {
            console.error(`❌ Failed to update role for ${userId}:`, err);
        }
    }
}

// ✅ Run updateRoles() when the bot starts
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Run once immediately
    await updateRoles();

    // ✅ Run updateRoles() every X minutes (defined in .env or default to 5 min)
    const interval = process.env.ROLE_CHECK_INTERVAL || 300000; // Default: 5 minutes
    setInterval(updateRoles, interval);

    console.log(`⏳ Role updates will run every ${interval / 60000} minutes.`);
});

// Log the bot port
const botPort = process.env.BOT_PORT || 3000;
console.log(`🌐 Bot is running on port ${botPort}`);

// Log in to Discord
client.login(process.env.TOKEN);
