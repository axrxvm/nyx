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

const privacyCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("privacy")
    .setDescription("View Nyx privacy policy")
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
          .setLabel("Open Privacy Policy")
          .setStyle(ButtonStyle.Link)
          .setURL("https://axrxvm.github.io/nyx/privacy"),
      ),
    ];

    const embed = makeBaseEmbed(
      "Nyx • Privacy Policy",
      "Nyx only processes data needed to provide AI features and safety checks.",
    ).addFields(
      {
        name: "Data processed",
        value:
          "Prompts, selected channel context, image/document inputs you provide (attachments/URLs), and optional model/tool choices.",
      },
      {
        name: "What is stored",
        value:
          "Conversation memory is temporary in-memory state and can be viewed, cleared, or disabled with `/memory` (in-memory state also resets on restart). Companion profile preferences (`/profile`) are persisted in bot storage until changed or reset.",
      },
      {
        name: "Third-party processing",
        value:
          "Requests may be sent to ALabs AI SDK providers for chat, image generation, OCR, and moderation. `/search` fetches public results from an allowlisted set of sources (for example Wikipedia and selected news outlets).",
      },
      {
        name: "User controls",
        value:
          "Use `/memory` to inspect, clear, disable, or enable memory and `/profile reset` to remove stored personalization.",
      },
      {
        name: "Security note",
        value:
          "Do not share passwords, tokens, financial info, or other sensitive personal data through prompts or files.",
      },
    );

    await interaction.reply({
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default privacyCommand;
