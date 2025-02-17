const fetch = require('node-fetch');

const API_URL = "http://localhost:3000/payment-request"; // Update if needed

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isModalSubmit()) return; // Only handle modals

        if (interaction.customId === 'verificationModal') {
            console.log("✅ Modal submission received!");

            // Collect user inputs
            const discordId = interaction.user.id;
            const twitterHandle = interaction.fields.getTextInputValue('twitter');
            const walletAddress = interaction.fields.getTextInputValue('wallet');

            console.log(`📡 Sending verification request for ${discordId}, ${twitterHandle}, ${walletAddress}`);

            try {
                // Send data to backend
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discordId, twitterHandle, walletAddress })
                });

                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                console.log("✅ Received API response:", data);

                await interaction.reply({
                    content: `✅ **Verification request received!**\nPlease send **${data.amount} SOL** to **${data.receivingAddress}**.`,
                    ephemeral: true
                });

            } catch (error) {
                console.error("❌ Verification error:", error);
                await interaction.reply({ content: '❌ Error during verification.', ephemeral: true });
            }
        }
    }
};
