import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { moderateText } from "../services/moderation";
import { makeBaseEmbed } from "../utils/embeds";

const moderateCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("moderate")
    .setDescription("Run ALabs moderation on text")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Text to analyze")
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const text = interaction.options.getString("text", true);

    try {
      const result = await moderateText(text);
      const topScores = result.topScores.length
        ? result.topScores
            .map((row) => `${row.category}: ${(row.score * 100).toFixed(2)}%`)
            .join("\n")
        : "No category scores returned.";

      const triggered = result.triggeredCategories.length
        ? result.triggeredCategories.join(", ")
        : "None";

      const embed = makeBaseEmbed("Nyx • Moderation Result")
        .addFields(
          {
            name: "Flagged",
            value: result.flagged ? "Yes" : "No",
            inline: true,
          },
          {
            name: "Model",
            value: result.model,
            inline: true,
          },
          {
            name: "Triggered Categories",
            value: triggered,
            inline: false,
          },
          {
            name: "Top Category Scores",
            value: topScores,
            inline: false,
          },
        )
        .setFooter({ text: "Use this as signal, then apply server policy and human review." });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/moderate failed:", message);
      await interaction.editReply("Something went wrong while running moderation.");
    }
  },
};

export default moderateCommand;
