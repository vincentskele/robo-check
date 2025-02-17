const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),

    async execute(interaction) {
        console.log("✅ /ping command received!");
        await interaction.reply('🏓 Pong!');
    }
};
