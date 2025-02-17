const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const fetch = require('node-fetch');

// ✅ Ensure API_BASE_URL is set correctly
const API_BASE_URL = process.env.API_BASE_URL?.trim() || "http://localhost:3000";

if (!API_BASE_URL.startsWith("http")) {
    console.error("❌ ERROR: API_BASE_URL is invalid. Must be an absolute URL.");
    process.exit(1);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Start the verification process'),

    async execute(interaction) {
        console.log("✅ /verify command received!");

        // ✅ Create a modal for user input
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
};

// ✅ Handle Modal Submission
module.exports.handleModalSubmit = async (interaction) => {
    if (interaction.customId !== 'verificationModal') return;

    console.log("✅ Modal submission received!");

    const discordId = interaction.user.id;
    const twitterHandle = interaction.fields.getTextInputValue('twitter');
    const walletAddress = interaction.fields.getTextInputValue('wallet');

    console.log(`📡 Sending verification request to ${API_BASE_URL}/payment-request`);

    try {
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

        await interaction.reply({
            content: `✅ **Verification request received!**\n\n📌 **Amount:** ${data.amount} SOL\n📩 **Send to:** ${data.receivingAddress}`,
            ephemeral: true
        });

    } catch (error) {
        console.error("❌ Verification error:", error);
        await interaction.reply({ content: '❌ Error during verification.', ephemeral: true });
    }
};