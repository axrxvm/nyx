import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { makeBaseEmbed } from "../utils/embeds";

const commandsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("commands")
    .setDescription("List all available commands")
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
    const embed = makeBaseEmbed("Nyx • Commands")
      .addFields(
        {
          name: "AI",
          value:
            "`/ask` Ask anything\n`/summarize` Summarize text\n`/imagine` Generate image\n`/coach` Guided plans + check-ins\n`/search` Web-grounded answers\n`/news headlines` Latest news list\n`/news digest` Source-grounded news summary",
          inline: true,
        },
        {
          name: "Companion",
          value:
            "`/profile` Personalize Nyx\n`/memory` View/clear memory\n`/models` List ALabs models\n`/ocr` Extract text from files\n`/moderate` Safety classification",
          inline: true,
        },
        {
          name: "Utility + Policy",
          value:
            "`/setchannel` Configure server auto-chat channel\n`/ping` Check latency\n`/status` Service health\n`/botinfo` Runtime info\n`/privacy` Privacy policy\n`/tos` Terms of service",
          inline: true,
        },
      )
      .setFooter({ text: "Also available: right-click message Apps actions • Powered by ALabs AI SDK" });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default commandsCommand;
