import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { appConfig } from "../config";
import { makeBaseEmbed } from "../utils/embeds";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

const statusCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show bot status and service health")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction) {
    const start = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let aiStatus = "Online";
    let aiLatency = "N/A";

    try {
      const healthStart = Date.now();
      const response = await fetch(`${appConfig.aiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${appConfig.aiApiKey}`,
        },
        body: JSON.stringify({
          model: appConfig.textModel,
          messages: [{ role: "user", content: "Respond with: ok" }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        }),
      });

      if (!response.ok) {
        aiStatus = "Degraded";
        aiLatency = `${Date.now() - healthStart}ms (${response.status})`;
      } else {
        aiLatency = `${Date.now() - healthStart}ms`;
      }
    } catch {
      aiStatus = "Offline";
    }

    const embed = makeBaseEmbed("Nyx • Status", "Live operational snapshot")
      .addFields(
        { name: "Bot", value: "Online", inline: true },
        { name: "AI Service", value: aiStatus, inline: true },
        { name: "Gateway", value: `${interaction.client.ws.ping}ms`, inline: true },
        { name: "Round Trip", value: `${Date.now() - start}ms`, inline: true },
        { name: "AI Latency", value: aiLatency, inline: true },
        { name: "Uptime", value: formatUptime(interaction.client.uptime ?? 0), inline: true },
      )
      .setFooter({ text: "Nyx • Powered by ALabs AI SDK" });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default statusCommand;
