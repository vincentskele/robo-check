const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
  } = require('discord.js');
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Start the verification process'),
  
    async execute(interaction) {
      console.log("✅ /verify command received!");
  
      // Create the modal
      const modal = new ModalBuilder()
        .setCustomId('verificationModal')
        .setTitle('Verification Form');
  
      // Twitter @username field
      const twitterInput = new TextInputBuilder()
        .setCustomId('twitter')
        .setLabel('Twitter @username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
  
      // Solana wallet address field
      const walletInput = new TextInputBuilder()
        .setCustomId('wallet')
        .setLabel('Solana Wallet Address')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
  
      // Build the modal with the two input rows
      modal.addComponents(
        new ActionRowBuilder().addComponents(twitterInput),
        new ActionRowBuilder().addComponents(walletInput)
      );
  
      try {
        await interaction.showModal(modal);
        console.log("✅ Modal displayed successfully!");
      } catch (error) {
        console.error("❌ Error displaying modal:", error);
        await interaction.reply({
          content: '❌ Error displaying the verification form.',
          ephemeral: true
        });
      }
    }
  };
  