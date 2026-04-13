import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  AttachmentBuilder,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  type MessageContextMenuCommandInteraction,
} from "discord.js";
import type { MessageContextCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { generateImage } from "../services/image";
import { collectImageAttachmentUrls } from "../utils/attachmentImages";

const imagineContextCommand: MessageContextCommand = {
  data: new ContextMenuCommandBuilder()
    .setName("Imagine")
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
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const targetText = interaction.targetMessage.content?.trim();
    const imageUrls = collectImageAttachmentUrls(interaction.targetMessage.attachments.values());

    const prompt = targetText || "Generate a creative image inspired by the attached image(s).";

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
      console.error("Context Imagine failed:", message);
      await interaction.editReply("Something went wrong while generating a response.");
    }
  },
};

export default imagineContextCommand;
