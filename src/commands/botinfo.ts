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

const botInfoCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot runtime and service information")
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
    const uptime = interaction.client.uptime ?? 0;
    const guildCount = interaction.client.guilds.cache.size;

    const embed = makeBaseEmbed(
      "Nyx • Bot Info",
      "Omnipresent Discord AI assistant",
    ).addFields(
      { name: "Uptime", value: formatUptime(uptime), inline: true },
      { name: "Gateway Ping", value: `${interaction.client.ws.ping}ms`, inline: true },
      { name: "Servers", value: `${guildCount}`, inline: true },
      { name: "Text Model", value: appConfig.textModel, inline: false },
      { name: "Image Model", value: appConfig.imageModel, inline: false },
      { name: "AI Stack", value: "ALabs AI SDK", inline: false },
      { name: "Runtime", value: "Bun + TypeScript + discord.js v14", inline: false },
    )
      .setFooter({ text: "Nyx • Made by Aarav Labs" });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default botInfoCommand;
