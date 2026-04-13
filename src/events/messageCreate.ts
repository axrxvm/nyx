import { AttachmentBuilder, EmbedBuilder, type Client } from "discord.js";
import { askAI, getRecentConversationContext } from "../services/ai";
import { addAssistantReply, addUserPrompt, getUserMemory } from "../services/memory";
import { isUserMemoryEnabled } from "../services/profile";
import { cleanMention } from "../utils/cleanMention";
import { checkRateLimit } from "../utils/rateLimit";
import { clampDiscordMessage } from "../utils/discordLimit";
import { generateImage } from "../services/image";
import { collectImageAttachmentUrls } from "../utils/attachmentImages";
import { getGuildChatChannelId } from "../services/guildChannel";
import { buildLongResponsePayload } from "../utils/longResponse";

const IMAGE_PROMPT_PATTERNS = [
  /^imagine\s+(.+)$/i,
  /^generate\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)$/i,
  /^make\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)$/i,
  /^draw\s+(.+)$/i,
];

function extractImagePrompt(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  for (const pattern of IMAGE_PROMPT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

export function registerMessageCreateEvent(client: Client): void {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || message.system) {
      return;
    }

    const isDirectMessage = message.channel.isDMBased();

    const botUserId = client.user?.id;
    if (!botUserId) {
      return;
    }

    const isMentioned = !isDirectMessage && message.mentions.has(botUserId);

    let isConfiguredGuildAutoChannel = false;
    if (!isDirectMessage && !isMentioned && message.guildId) {
      const guildAutoChannelId = await getGuildChatChannelId(message.guildId);
      isConfiguredGuildAutoChannel = guildAutoChannelId === message.channelId;
    }

    if (!isDirectMessage && !isConfiguredGuildAutoChannel && !isMentioned) {
      return;
    }

    if (!checkRateLimit(message.author.id)) {
      await message.reply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const isContinuousChat = isDirectMessage || isConfiguredGuildAutoChannel;
    let prompt = isContinuousChat ? message.content.trim() : cleanMention(message.content, botUserId);
    const messageImageUrls = collectImageAttachmentUrls(message.attachments.values());
    let referencedImageUrls: string[] = [];

    if (!prompt && message.reference?.messageId) {
      try {
        const referenced = await message.fetchReference();
        const referencedText = referenced.content.trim();
        referencedImageUrls = collectImageAttachmentUrls(referenced.attachments.values());
        if (referencedText) {
          prompt = `Explain this message:\n${referencedText}`;
        } else if (referencedImageUrls.length > 0) {
          prompt = "Describe the referenced image(s).";
        }
      } catch {
        prompt = "Please explain the message I replied to.";
      }
    }

    const imageUrls = [...new Set([...messageImageUrls, ...referencedImageUrls])];

    if (!prompt && imageUrls.length > 0) {
      prompt = "Describe the attached image(s).";
    }

    if (!prompt) {
      if (isContinuousChat) {
        return;
      }

      await message.reply("Please include a question or prompt after mentioning me.");
      return;
    }

    await message.channel.sendTyping().catch(() => undefined);
    const typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
      void message.channel.sendTyping().catch(() => undefined);
    }, 7_000);

    try {
      const imagePrompt = extractImagePrompt(prompt);
      if (imagePrompt) {
        const image = await generateImage(imagePrompt, { imageUrls });
        const attachment = new AttachmentBuilder(image.buffer, {
          name: image.filename,
        });

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Nyx • Image Result")
          .setDescription(`Prompt: ${imagePrompt}`)
          .setImage(`attachment://${image.filename}`)
          .setFooter({ text: "Powered by ALabs AI SDK" })
          .setTimestamp(new Date());

        await message.reply({
          embeds: [embed],
          files: [attachment],
        });
        return;
      }

      const channelContext = await getRecentConversationContext(
        message.channel,
        isContinuousChat ? 30 : undefined,
        {
          includeBotMessages: isContinuousChat,
          excludeMessageId: message.id,
          includeSummaryOfOlderMessages: isContinuousChat,
          maxFetchMessages: isContinuousChat ? 100 : undefined,
        },
      );
      const memoryEnabled = await isUserMemoryEnabled(message.author.id);
      const memory = memoryEnabled ? getUserMemory(message.author.id) : [];

      const promptContext = isDirectMessage
        ? {
            channelKind: "direct-message",
            responseMode: "continuous-chat",
            instruction:
              "Treat this as an ongoing chat thread. The latest user message is the active request even without a mention.",
          }
        : isConfiguredGuildAutoChannel
          ? {
              channelKind: "guild-auto-reply-channel",
              responseMode: "continuous-chat",
              instruction:
                "This server channel is configured for automatic replies. Continue naturally and keep strong continuity with recent messages.",
            }
          : {
              channelKind: "guild-mention",
              responseMode: "mention-triggered",
              instruction:
                "Reply to the current mention request. Use recent context only when it directly helps answer this turn.",
            };

      if (memoryEnabled) {
        addUserPrompt(message.author.id, prompt);
      }
      const response = await askAI(prompt, {
        channelContext,
        promptContext,
        userMemory: memory,
        userId: message.author.id,
        imageUrls,
      });
      if (memoryEnabled) {
        addAssistantReply(message.author.id, response);
      }

      await message.reply(buildLongResponsePayload(response, "chat-response"));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Mention AI failed:", errorMessage);
      await message.reply("Something went wrong while generating a response.");
    } finally {
      clearInterval(typingInterval);
    }
  });
}
