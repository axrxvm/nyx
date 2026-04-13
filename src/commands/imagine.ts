import {
  ApplicationIntegrationType,
  AttachmentBuilder,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { generateImage } from "../services/image";
import { attachmentIsImage } from "../utils/attachmentImages";

const imagineCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("imagine")
    .setDescription("Generate an image using AI")
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
        .setName("prompt")
        .setDescription("Describe the image")
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName("image")
        .setDescription("Optional reference image")
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName("image2")
        .setDescription("Optional second reference image")
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName("image3")
        .setDescription("Optional third reference image")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const prompt = interaction.options.getString("prompt", true);
    const imageAttachments = [
      interaction.options.getAttachment("image"),
      interaction.options.getAttachment("image2"),
      interaction.options.getAttachment("image3"),
    ].filter((attachment) => Boolean(attachment));

    const imageUrls = imageAttachments
      .filter((attachment) => attachmentIsImage(attachment!))
      .map((attachment) => attachment!.url);

    try {
      const image = await generateImage(prompt, { imageUrls });
      const attachment = new AttachmentBuilder(image.buffer, {
        name: image.filename,
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Nyx • Image Result")
        .setDescription(`Prompt: ${prompt}`)
        .setImage(`attachment://${image.filename}`)
        .setFooter({ text: "Powered by ALabs AI SDK" })
        .setTimestamp(new Date());

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/imagine failed:", message);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default imagineCommand;
