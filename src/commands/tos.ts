import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { makeBaseEmbed } from "../utils/embeds";

const tosCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tos")
    .setDescription("View Nyx terms of service")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction) {
    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Open Terms of Service")
          .setStyle(ButtonStyle.Link)
          .setURL("https://axrxvm.github.io/nyx/tos"),
      ),
    ];

    const embed = makeBaseEmbed("Nyx • Terms of Service").addFields(
      {
        name: "Acceptable use",
        value:
          "Do not use Nyx for abuse, harassment, scams, spam, illegal activity, malware, or other policy-violating content.",
      },
      {
        name: "Feature behavior",
        value:
          "Nyx may use AI chat, image generation, OCR, moderation, and web search integrations. Results can vary by provider availability and limits.",
      },
      {
        name: "Accuracy and responsibility",
        value:
          "AI outputs can be wrong, incomplete, or outdated. You are responsible for reviewing outputs before relying on them.",
      },
      {
        name: "Safety and enforcement",
        value:
          "Requests may be rate-limited, moderated, blocked, or access-restricted to protect users and service reliability.",
      },
      {
        name: "Service terms",
        value:
          "Service is provided as-is and may change, degrade, or be discontinued without notice.",
      },
    );

    await interaction.reply({
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default tosCommand;
