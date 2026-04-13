import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import {
  askAI,
  getRecentConversationContext,
  SelectedAlabsModelUnavailableError,
} from "../services/ai";
import { addAssistantReply, addUserPrompt, getUserMemory } from "../services/memory";
import { isUserMemoryEnabled } from "../services/profile";
import { clampDiscordMessage } from "../utils/discordLimit";
import { resolveAiInputsFromSources } from "../services/fileInput";
import { buildLongResponsePayload } from "../utils/longResponse";

const ASK_MODEL_CHOICES = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
  "openai/gpt-oss-120b",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-v3.2-speciale",
  "deepseek/deepseek-r1-0528",
  "qwen/qwen3-32b",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3-235b-a22b",
  "z-ai/glm-5",
  "z-ai/glm-4.7",
  "z-ai/glm-4.7-flash",
  "moonshotai/kimi-k2.5",
  "moonshotai/kimi-k2-thinking",
  "moonshotai/kimi-k2-0905",
  "x-ai/grok-4.1-fast",
  "stepfun/step-3.5-flash",
  "minimax/minimax-m2.5",
  "minimax/minimax-m2.1",
  "nvidia/nemotron-nano-12b-v2-vl",
  "bytedance-seed/seed-1.6-flash",
  "liquid/lfm-2-24b-a2b",
] as const;

const SOURCE_URL_PATTERN = /https?:\/\/[^\s,]+/gi;
const MAX_SOURCE_DOCS = 3;

const askCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the AI a question")
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
        .setName("question")
        .setDescription("Your question")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("model")
        .setDescription("Optional model override")
        .setRequired(false)
        .addChoices(...ASK_MODEL_CHOICES.map((model) => ({ name: model, value: model }))),
    )
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("Optional file upload (image/pdf/text/code/other)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("sources")
        .setDescription("Optional extra file/document URLs (up to 3 total docs)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const question = interaction.options.getString("question", true);
    const selectedModel = interaction.options.getString("model") ?? undefined;
    const uploadedFile = interaction.options.getAttachment("file");
    const extraSources = interaction.options.getString("sources") ?? "";

    const sourceUrls = [...new Set((extraSources.match(SOURCE_URL_PATTERN) ?? []).map((url) => url.trim()))];
    const totalSourceCount = sourceUrls.length + (uploadedFile ? 1 : 0);
    if (totalSourceCount > MAX_SOURCE_DOCS) {
      await interaction.editReply(`Provide at most ${MAX_SOURCE_DOCS} documents total (uploaded + URLs).`);
      return;
    }

    const resolvedInputs = await resolveAiInputsFromSources([
      ...(uploadedFile
        ? [{
            url: uploadedFile.url,
            filename: uploadedFile.name,
            contentType: uploadedFile.contentType,
          }]
        : []),
      ...sourceUrls.map((url) => ({ url })),
    ], MAX_SOURCE_DOCS);

    try {
      const channelContext = await getRecentConversationContext(interaction.channel);
      const memoryEnabled = await isUserMemoryEnabled(interaction.user.id);
      const memory = memoryEnabled ? getUserMemory(interaction.user.id) : [];
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
        responseMode: "slash-command",
        instruction: "User explicitly invoked /ask. Prioritize directly answering their question.",
      };
      let lastUpdateAt = 0;
      let lastLength = 0;

      if (memoryEnabled) {
        addUserPrompt(interaction.user.id, question);
      }
      const response = await askAI(question, {
        channelContext,
        promptContext,
        userMemory: memory,
        userId: interaction.user.id,
        imageUrls: resolvedInputs.imageUrls,
        files: resolvedInputs.files,
        inputTextBlocks: resolvedInputs.inputTextBlocks,
        pdfEngine: "native",
        model: selectedModel,
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
        addAssistantReply(interaction.user.id, response);
      }

      await interaction.editReply(buildLongResponsePayload(response, "ask-response"));
    } catch (error) {
      if (error instanceof SelectedAlabsModelUnavailableError) {
        await interaction.editReply(error.message);
        return;
      }

      console.error("/ask failed:", error);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default askCommand;
