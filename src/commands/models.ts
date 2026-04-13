import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { fetchAvailableModels } from "../services/models";
import { makeBaseEmbed } from "../utils/embeds";

const modelsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("models")
    .setDescription("List available ALabs AI SDK models")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many models to show")
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(40),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const limit = interaction.options.getInteger("limit") ?? 20;

    try {
      const models = await fetchAvailableModels(limit);
      const list = models.map((model) => `• ${model.id}`).join("\n");

      const embed = makeBaseEmbed("Nyx • Available Models", `Showing up to ${limit} models`)
        .addFields({
          name: "Model IDs",
          value: list.slice(0, 1024),
          inline: false,
        })
        .setFooter({ text: "Use /ask question:<...> model:<...> to choose one." });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/models failed:", message);
      await interaction.editReply("Could not fetch models right now.");
    }
  },
};

export default modelsCommand;
