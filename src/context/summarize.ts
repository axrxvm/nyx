import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  type MessageContextMenuCommandInteraction,
} from "discord.js";
import type { MessageContextCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { summarizeText } from "../services/summarize";
import { addAssistantReply, addUserPrompt, getUserMemory } from "../services/memory";
import { getRecentConversationContext } from "../services/ai";
import { isUserMemoryEnabled } from "../services/profile";
import { resolveAiInputsFromSources } from "../services/fileInput";
import { clampDiscordMessage } from "../utils/discordLimit";
import { buildLongResponsePayload } from "../utils/longResponse";

const MAX_CONTEXT_DOCS = 3;

const summarizeContextCommand: MessageContextCommand = {
  data: new ContextMenuCommandBuilder()
    .setName("Summarize")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .setType(ApplicationCommandType.Message),

  async execute(interaction: MessageContextMenuCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const targetText = interaction.targetMessage.content?.trim();

    try {
      const attachmentSources = [...interaction.targetMessage.attachments.values()]
        .slice(0, MAX_CONTEXT_DOCS)
        .map((attachment) => ({
          url: attachment.url,
          filename: attachment.name,
          contentType: attachment.contentType,
        }));
      const resolvedInputs = await resolveAiInputsFromSources(attachmentSources, MAX_CONTEXT_DOCS);

      const hasInputs = Boolean(targetText)
        || resolvedInputs.imageUrls.length > 0
        || resolvedInputs.files.length > 0
        || resolvedInputs.inputTextBlocks.length > 0;
      if (!hasInputs) {
        await interaction.editReply("That message has no usable text or attachments to summarize.");
        return;
      }

      const summarizeInput = targetText || "Summarize the attached content.";
      const channelContext = await getRecentConversationContext(interaction.channel);
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-message-context-menu" : "direct-message-context-menu",
        responseMode: "message-context-command",
        instruction:
          "User invoked the Summarize context action on a specific message. Prioritize concise summarization of that target message and its attachments.",
      };
      const memoryEnabled = await isUserMemoryEnabled(interaction.user.id);
      const memory = memoryEnabled ? getUserMemory(interaction.user.id) : [];
      let lastUpdateAt = 0;
      let lastLength = 0;

      if (memoryEnabled) {
        addUserPrompt(interaction.user.id, `Summarize message: ${summarizeInput}`);
      }
      const summary = await summarizeText(summarizeInput, {
        channelContext,
        promptContext,
        userMemory: memory,
        userId: interaction.user.id,
        imageUrls: resolvedInputs.imageUrls,
        files: resolvedInputs.files,
        inputTextBlocks: resolvedInputs.inputTextBlocks,
        pdfEngine: "native",
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
      if (memoryEnabled) {
        addAssistantReply(interaction.user.id, summary);
      }

      await interaction.editReply(buildLongResponsePayload(summary, "context-summary"));
    } catch (error) {
      console.error("Context Summarize failed:", error);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default summarizeContextCommand;
