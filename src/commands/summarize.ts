import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { summarizeText } from "../services/summarize";
import { addAssistantReply, addUserPrompt, getUserMemory } from "../services/memory";
import { getRecentConversationContext } from "../services/ai";
import { clampDiscordMessage } from "../utils/discordLimit";
import { buildLongResponsePayload } from "../utils/longResponse";

const summarizeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize text")
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
        .setDescription("Text to summarize")
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const text = interaction.options.getString("text", true);

    try {
      const channelContext = await getRecentConversationContext(interaction.channel);
      const memory = getUserMemory(interaction.user.id);
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
        responseMode: "slash-command",
        instruction: "User explicitly invoked /summarize. Focus on concise summarization of the provided text.",
      };
      let lastUpdateAt = 0;
      let lastLength = 0;

      addUserPrompt(interaction.user.id, `Summarize: ${text}`);
      const response = await summarizeText(text, {
        channelContext,
        promptContext,
        userMemory: memory,
        userId: interaction.user.id,
        stream: true,
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
      addAssistantReply(interaction.user.id, response);

      await interaction.editReply(buildLongResponsePayload(response, "summary"));
    } catch (error) {
      console.error("/summarize failed:", error);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default summarizeCommand;
