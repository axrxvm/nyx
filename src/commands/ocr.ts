import {
  ApplicationIntegrationType,
  AttachmentBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { runOcr } from "../services/ocr";
import { askAI } from "../services/ai";
import { clampDiscordMessage } from "../utils/discordLimit";

const DISCORD_MESSAGE_MAX = 2000;

function buildOcrReplyPayload(model: string, pageCount: number, body: string): string | {
  content: string;
  files: [AttachmentBuilder];
} {
  const header = [`OCR model: ${model}`, `Pages: ${pageCount}`, ""].join("\n");
  const combined = `${header}${body}`;
  if (combined.length <= DISCORD_MESSAGE_MAX) {
    return clampDiscordMessage(combined);
  }

  const filename = `ocr-${Date.now()}.txt`;
  const attachment = new AttachmentBuilder(Buffer.from(body, "utf8"), { name: filename });

  return {
    content: clampDiscordMessage([
      `OCR model: ${model}`,
      `Pages: ${pageCount}`,
      "",
      `Output was too long for Discord, so it is attached as ${filename}.`,
    ].join("\n")),
    files: [attachment],
  };
}

const ocrCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ocr")
    .setDescription("Extract text from an image or document URL")
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
        .setName("url")
        .setDescription("Public image/document URL")
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("Attachment to OCR")
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("summarize")
        .setDescription("Also generate a short summary")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const url = interaction.options.getString("url")?.trim();
    const file = interaction.options.getAttachment("file");
    const summarize = interaction.options.getBoolean("summarize") ?? false;

    const inputUrl = url || file?.url;
    if (!inputUrl) {
      await interaction.editReply("Provide either `url` or `file`.");
      return;
    }

    try {
      const result = await runOcr({
        url: inputUrl,
        contentType: file?.contentType,
        filename: file?.name,
      });

      if (!summarize) {
        await interaction.editReply(buildOcrReplyPayload(result.model, result.pageCount, result.text));
        return;
      }

      const summary = await askAI(`Summarize this OCR extraction:\n\n${result.text}`, {
        promptContext: {
          channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
          responseMode: "slash-command",
          instruction:
            "User explicitly invoked /ocr with summarize=true. Summarize extracted text faithfully and concisely.",
        },
        userId: interaction.user.id,
        systemPrompt:
          "Summarize OCR output in concise bullet points. Include key entities, dates, totals, and action items if present.",
      });

      await interaction.editReply(buildOcrReplyPayload(result.model, result.pageCount, summary));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/ocr failed:", message);
      await interaction.editReply("Something went wrong while processing OCR.");
    }
  },
};

export default ocrCommand;
