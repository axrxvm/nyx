import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { askAI, getRecentConversationContext } from "../services/ai";
import { addAssistantReply, addUserPrompt, getUserMemory } from "../services/memory";
import { isUserMemoryEnabled } from "../services/profile";
import { clampDiscordMessage } from "../utils/discordLimit";
import { resolveAiInputsFromSources } from "../services/fileInput";
import { buildLongResponsePayload } from "../utils/longResponse";

const SOURCE_URL_PATTERN = /https?:\/\/[^\s,]+/gi;
const MAX_SOURCE_DOCS = 3;

const coachCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("coach")
    .setDescription("Get a focused action plan or check-in from Nyx")
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
        .setName("focus")
        .setDescription("What you need help with")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Companion coaching style")
        .setRequired(false)
        .addChoices(
          { name: "Action Plan", value: "plan" },
          { name: "Check-in", value: "checkin" },
          { name: "Motivation", value: "motivation" },
        ),
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

    const focus = interaction.options.getString("focus", true);
    const mode = interaction.options.getString("mode") ?? "plan";
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

    const modeInstruction =
      mode === "checkin"
        ? "Run a short supportive check-in: assess current state, one blocker, one next step, and a gentle accountability prompt."
        : mode === "motivation"
          ? "Give motivational but practical guidance with one reframed mindset and three concrete actions."
          : "Create a clear action plan with priorities, time estimates, and first step in the next 10 minutes.";

    try {
      const channelContext = await getRecentConversationContext(interaction.channel);
      const memoryEnabled = await isUserMemoryEnabled(interaction.user.id);
      const memory = memoryEnabled ? getUserMemory(interaction.user.id) : [];
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
        responseMode: "slash-command",
        instruction: `User explicitly invoked /coach in ${mode} mode. Keep guidance practical and mode-aligned.`,
      };
      let lastUpdateAt = 0;
      let lastLength = 0;

      if (memoryEnabled) {
        addUserPrompt(interaction.user.id, `Coach (${mode}): ${focus}`);
      }
      const response = await askAI(`Coach me on: ${focus}`, {
        channelContext,
        promptContext,
        userMemory: memory,
        userId: interaction.user.id,
        imageUrls: resolvedInputs.imageUrls,
        files: resolvedInputs.files,
        inputTextBlocks: resolvedInputs.inputTextBlocks,
        pdfEngine: "native",
        stream: true,
        systemPrompt: [
          "You are Nyx Companion, a practical AI coach in Discord.",
          "Be empathic, direct, and actionable.",
          modeInstruction,
          "Keep output compact with sections and bullet points.",
        ].join(" "),
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
      await interaction.editReply(buildLongResponsePayload(response, "coach-response"));
    } catch (error) {
      console.error("/coach failed:", error);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default coachCommand;
