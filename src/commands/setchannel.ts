import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import {
  clearGuildChatChannel,
  getGuildChatChannelId,
  setGuildChatChannel,
} from "../services/guildChannel";

function hasManageGuildPermission(interaction: Parameters<SlashCommand["execute"]>[0]): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

const setChannelCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the server channel where Nyx auto-replies to every message")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set the auto-chat channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Text channel to use for continuous Nyx chat")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View the currently configured auto-chat channel"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear")
        .setDescription("Disable auto-chat channel mode"),
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command only works in servers.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "view") {
      const configured = await getGuildChatChannelId(interaction.guildId);
      await interaction.reply({
        content: configured
          ? `Nyx auto-chat is enabled in <#${configured}>.`
          : "No auto-chat channel is configured yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!hasManageGuildPermission(interaction)) {
      await interaction.reply({
        content: "You need the Manage Server permission to change this setting.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "clear") {
      const removed = await clearGuildChatChannel(interaction.guildId);
      await interaction.reply({
        content: removed
          ? "Auto-chat channel cleared. Nyx will only reply on mention in this server."
          : "No auto-chat channel was set.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    await setGuildChatChannel(interaction.guildId, channel.id);

    await interaction.reply({
      content: `Nyx auto-chat is now enabled in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default setChannelCommand;
