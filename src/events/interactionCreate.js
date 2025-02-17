const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
  } = require('discord.js');
  const fetch = require('node-fetch');
  
  const API_BASE_URL = process.env.API_BASE_URL?.trim() || "http://localhost:3000";
  const VANITY_ADDRESS = process.env.VANITY_ADDRESS?.trim() || "NO_VANITY_ADDRESS_PROVIDED";
  
  // Base58 regex pattern for Solana addresses (32-44 characters)
  const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$/;
  
  // Export the main event handler and pass the `client`
  module.exports = async function (interaction, client) {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'verify') {
        console.log("✅ /verify command triggered!");
  
        const modal = new ModalBuilder()
          .setCustomId('verificationModal')
          .setTitle('Verification Form');
  
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('twitter')
              .setLabel('Twitter @username')
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
    }
  
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'verificationModal') {
        console.log("✅ Modal submission received!");
  
        const discordId = interaction.user.id;
        let twitterHandle = interaction.fields.getTextInputValue('twitter').replace(/@/g, '');
        const walletAddress = interaction.fields.getTextInputValue('wallet');
  
        console.log(`📡 Validating wallet address: ${walletAddress}`);
  
        // 🔍 Validate if the wallet address is a valid Solana address
        if (!BASE58_REGEX.test(walletAddress)) {
          console.error("❌ Invalid Solana address format!");
          return await interaction.reply({
            content: '❌ **Invalid wallet address!** Please enter a **valid Solana address** (Base58, 32-44 characters).',
            ephemeral: true,
          });
        }
  
        console.log("✅ Wallet address is valid!");
  
        console.log(`📡 Sending verification request for Discord ID: ${discordId}`);
  
        try {
          await interaction.deferReply({ ephemeral: true });
  
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
  
          await interaction.editReply({
            content: `✅ **Verification request received!**\n` +
                     `📌 **Copy this amount:** ${data.amount} SOL\n` +
                     `📩 **Send to:** ${VANITY_ADDRESS}`
          });
  
        } catch (error) {
          console.error("❌ Verification error:", error);
          await interaction.editReply({
            content: '❌ An error occurred while processing your verification request. Please try again later.'
          });
        }
      }
    }
  };
  