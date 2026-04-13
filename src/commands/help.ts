import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { makeBaseEmbed } from "../utils/embeds";

const helpCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show how to use Nyx")
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
    const embed = makeBaseEmbed(
      "Nyx • Help",
      "Nyx is an AI assistant for servers, bot DMs, and group DMs. Made by Aarav Labs.",
    )
      .addFields(
        {
          name: "Ask in chat",
          value: "Mention the bot: `@Nyx explain black holes`",
          inline: false,
        },
        {
          name: "Slash commands",
          value:
            "`/ask`, `/summarize`, `/imagine`, `/coach`, `/search`, `/news headlines`, `/news digest`, `/ocr`, `/moderate`, `/profile`, `/memory`, `/setchannel`, `/models`, `/commands`, `/ping`, `/status`, `/botinfo`",
          inline: false,
        },
        {
          name: "Right-click message actions",
          value: "Apps → `Summarize`, `Explain`, `Generate Reply`, `Imagine`",
          inline: false,
        },
        {
          name: "Companion setup",
          value: "Use `/profile set` to personalize tone and goals. Use `/memory` to inspect or clear saved context.",
          inline: false,
        },
        {
          name: "Power tools",
          value: "Use `/search` for current web-backed answers, `/ocr` for text extraction, and `/moderate` for quick safety checks.",
          inline: false,
        },
      )
      .setFooter({ text: "Tip: mention + 'imagine ...' to generate images directly." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default helpCommand;
