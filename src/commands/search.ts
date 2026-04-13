import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { askAI } from "../services/ai";
import { formatSearchContext, searchWeb } from "../services/search";
import { clampDiscordMessage } from "../utils/discordLimit";
import { buildLongResponsePayload } from "../utils/longResponse";

const searchCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Answer using live web search context")
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
        .setName("query")
        .setDescription("What to search and answer")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("freshness")
        .setDescription("Optional recency filter")
        .setRequired(false)
        .addChoices(
          { name: "Past day", value: "pd" },
          { name: "Past week", value: "pw" },
          { name: "Past month", value: "pm" },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const query = interaction.options.getString("query", true);
    const freshness = (interaction.options.getString("freshness") ?? undefined) as
      | "pd"
      | "pw"
      | "pm"
      | undefined;

    try {
      const searchResults = await searchWeb(query, freshness);
      const context = formatSearchContext(searchResults);
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
        responseMode: "slash-command",
        instruction:
          "User explicitly invoked /search. Use the supplied web results as the primary evidence base.",
      };
      let lastUpdateAt = 0;
      let lastLength = 0;

      const response = await askAI(`Question: ${query}\n\nWeb search results:\n${context}`, {
        promptContext,
        userId: interaction.user.id,
        stream: true,
        systemPrompt:
          "Use provided web results as primary evidence. If evidence is insufficient, say so. Include a short sources list with URLs.",
        onProgress: async (partial) => {
          const safePartial = clampDiscordMessage(partial);
          const now = Date.now();
          if (now - lastUpdateAt < 900 && safePartial.length - lastLength < 80) {
            return;
          }

          lastUpdateAt = now;
          lastLength = safePartial.length;
          await interaction.editReply(safePartial);
        },
      });

      await interaction.editReply(buildLongResponsePayload(response, "search-response"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/search failed:", message);
      await interaction.editReply("Something went wrong while searching the web.");
    }
  },
};

export default searchCommand;
