require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Fetch the Discord server (guild)
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    if (!guild) {
        console.error("❌ Guild not found!");
        return;
    }

    // Load verified users from JSON
    let verifiedUsers = [];
    try {
        const data = fs.readFileSync('./src/data/verified.json', 'utf8');
        const jsonData = JSON.parse(data);

        if (!Array.isArray(jsonData)) {
            throw new Error("❌ Expected an array in verified.json");
        }

        // Extract only `discordId` from verified users
        verifiedUsers = jsonData
            .filter(user => user.verified) // Only verified users
            .map(user => user.discordId); // Extract discordId

        console.log("✅ Verified Users:", verifiedUsers);
    } catch (err) {
        console.error("❌ Error reading verified.json:", err);
        return;
    }

    // Fetch role from environment variables
    const role = await guild.roles.fetch(process.env.ROLE_ID);
    if (!role) {
        console.error("❌ Role not found!");
        return;
    }

    // Assign roles to verified users
    for (const userId of verifiedUsers) {
        try {
            const member = await guild.members.fetch(userId);
            if (member) {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                    console.log(`✅ Assigned role to ${member.user.tag}`);
                } else {
                    console.log(`⚠️ ${member.user.tag} already has the role`);
                }
            }
        } catch (err) {
            console.error(`❌ Failed to assign role to user ${userId}:`, err);
        }
    }
});

// Log in to Discord
client.login(process.env.TOKEN);
