import {
  ApplicationIntegrationType,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { checkRateLimit } from "../utils/rateLimit";
import { getLatestNews, type SearchFreshness } from "../services/search";
import { askAI } from "../services/ai";
import { clampDiscordMessage } from "../utils/discordLimit";
import { buildLongResponsePayload } from "../utils/longResponse";

function toDiscordTimestamp(input: string | undefined): string {
  if (!input) {
    return "Unknown";
  }

  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) {
    return input;
  }

  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function stripModelSourcesSection(input: string): string {
  return input.replace(/\n\s*(sources?|citations?)\s*:\s*[\s\S]*$/i, "").trim();
}

const newsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("news")
    .setDescription("Get latest internet news with freshness filters")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("headlines")
        .setDescription("Show latest headlines in a clean list")
        .addStringOption((option) =>
          option
            .setName("freshness")
            .setDescription("How recent the news should be")
            .setRequired(false)
            .addChoices(
              { name: "Past day", value: "pd" },
              { name: "Past week", value: "pw" },
              { name: "Past month", value: "pm" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("Optional topic filter (e.g. AI, crypto, sports)")
            .setRequired(false)
            .setMaxLength(80),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("digest")
        .setDescription("Generate an evidence-grounded digest from fresh headlines")
        .addStringOption((option) =>
          option
            .setName("freshness")
            .setDescription("How recent the news should be")
            .setRequired(false)
            .addChoices(
              { name: "Past day", value: "pd" },
              { name: "Past week", value: "pw" },
              { name: "Past month", value: "pm" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("Optional topic filter (e.g. AI, crypto, sports)")
            .setRequired(false)
            .setMaxLength(80),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.editReply("Rate limit exceeded. Please wait a moment.");
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const freshness = (interaction.options.getString("freshness") ?? undefined) as SearchFreshness | undefined;
    const topic = interaction.options.getString("topic")?.trim() ?? "";

    try {
      const freshnessLabel = freshness === "pd"
        ? "Past day"
        : freshness === "pw"
          ? "Past week"
          : freshness === "pm"
            ? "Past month"
            : "Any";

      if (subcommand === "headlines") {
        const results = await getLatestNews(freshness, topic || undefined, 8);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Nyx • Latest News")
          .setDescription(
            [
              topic ? `Topic: **${topic}**` : "Topic: **Top headlines**",
              `Freshness: **${freshnessLabel}**`,
            ].join("\n"),
          )
          .addFields(
            results.slice(0, 8).map((item, index) => ({
              name: `${index + 1}. ${item.title.slice(0, 230)}`,
              value: [
                `Source: **${item.source}**`,
                `Published: ${toDiscordTimestamp(item.publishedAt)}`,
                `[Read more](${item.url})`,
              ].join("\n"),
              inline: false,
            })),
          )
          .setFooter({ text: "Powered by live RSS news sources" })
          .setTimestamp(new Date());

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const results = await getLatestNews(freshness, topic || undefined, 8);
      const newsContext = results
        .map((item, index) => [
          `${index + 1}. ${item.title}`,
          `Source: ${item.source}`,
          `Published: ${item.publishedAt ?? "unknown"}`,
          `URL: ${item.url}`,
          `Snippet: ${item.description}`,
        ].join("\n"))
        .join("\n\n");
      const promptContext = {
        channelKind: interaction.inGuild() ? "guild-slash-command" : "direct-message-slash-command",
        responseMode: "slash-command",
        instruction:
          "User explicitly invoked /news digest. Ground the digest strictly in the provided headlines.",
      };

      let lastUpdateAt = 0;
      let lastLength = 0;

      const digestBody = await askAI(
        [
          `Create a concise latest news digest${topic ? ` for topic: ${topic}` : ""}.`,
          `Freshness filter: ${freshnessLabel}.`,
          "Use ONLY the provided items as evidence.",
          "",
          "News items:",
          newsContext,
        ].join("\n"),
        {
          promptContext,
          userId: interaction.user.id,
          stream: true,
          systemPrompt: [
            "You are a precise news analyst.",
            "Use only the provided news items; do not invent facts.",
            "No greeting or identity preface.",
            "Keep output concise and under 900 characters.",
            "Output sections:",
            "1) Headline overview (exactly 3 bullets)",
            "2) Notable developments (2 bullets)",
            "3) Risks / uncertainty (2 bullets)",
            "Do not include a sources section; it will be added separately.",
            "If evidence is thin or conflicting, explicitly say so.",
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
        },
      );

      const cleanDigestBody = stripModelSourcesSection(digestBody);
      const sourceLines = results.map((item, index) => `${index + 1}. ${item.source} — ${item.url}`);
      const finalDigest = [
        `News Digest${topic ? ` • ${topic}` : ""} (${freshnessLabel})`,
        "",
        cleanDigestBody,
        "",
        "Sources:",
        ...sourceLines,
      ].join("\n");

      await interaction.editReply(
        buildLongResponsePayload(finalDigest, "news-digest", { includePreview: false }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("/news failed:", message);
      await interaction.editReply("Could not fetch fresh news right now. Try again in a moment.");
    }
  },
};

export default newsCommand;
