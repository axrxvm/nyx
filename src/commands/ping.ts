import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { makeBaseEmbed } from "../utils/embeds";

const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot and API latency")
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

    const wsPing = interaction.client.ws.ping;
    const roundTrip = Date.now() - start;

    const embed = makeBaseEmbed("Nyx • Ping")
      .addFields(
        { name: "Gateway", value: `${wsPing}ms`, inline: true },
        { name: "Round Trip", value: `${roundTrip}ms`, inline: true },
      )
      .setFooter({ text: "Lower is better." });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default pingCommand;
