import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import { clearUserMemory, getUserMemory, getUserMemoryStats } from "../services/memory";
import { isUserMemoryEnabled, upsertUserProfile } from "../services/profile";
import { makeBaseEmbed } from "../utils/embeds";

const memoryCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("memory")
    .setDescription("View or clear your Nyx memory")
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
        .setName("action")
        .setDescription("What to do with your memory")
        .setRequired(true)
        .addChoices(
          { name: "View", value: "view" },
          { name: "Clear", value: "clear" },
          { name: "Disable", value: "disable" },
          { name: "Enable", value: "enable" },
        ),
    ),

  async execute(interaction) {
    const action = interaction.options.getString("action", true);

    if (action === "disable") {
      await upsertUserProfile(interaction.user.id, { memoryEnabled: false });
      clearUserMemory(interaction.user.id);
      await interaction.reply({
        content: "Memory is now disabled for your account. Nyx will no longer store new conversation memory until you enable it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "enable") {
      await upsertUserProfile(interaction.user.id, { memoryEnabled: true });
      await interaction.reply({
        content: "Memory is now enabled for your account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "clear") {
      const removed = clearUserMemory(interaction.user.id);
      await interaction.reply({
        content: removed
          ? "Your memory was cleared for this account."
          : "No saved memory was found for your account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memoryEnabled = await isUserMemoryEnabled(interaction.user.id);
    if (!memoryEnabled) {
      await interaction.reply({
        content: "Memory is currently disabled for your account. Use `/memory action:Enable` to turn it back on.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memory = getUserMemory(interaction.user.id);
    const stats = getUserMemoryStats(interaction.user.id);

    if (memory.length === 0) {
      await interaction.reply({
        content: "No memory entries yet. Chat with Nyx using /ask or mentions to build context.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const preview = memory
      .slice(-6)
      .map((entry, index) => {
        const compact = entry.content.replace(/\s+/g, " ").trim().slice(0, 140);
        return `${index + 1}. **${entry.role}**: ${compact}${entry.content.length > 140 ? "…" : ""}`;
      })
      .join("\n");

    const embed = makeBaseEmbed("Nyx • Memory", "Recent memory snapshot for your account")
      .addFields(
        {
          name: "Entries",
          value: `${stats.entryCount}`,
          inline: true,
        },
        {
          name: "Last Updated",
          value: stats.updatedAt ? `<t:${Math.floor(stats.updatedAt / 1000)}:R>` : "Unknown",
          inline: true,
        },
        {
          name: "Recent Context",
          value: preview,
          inline: false,
        },
      )
      .setFooter({ text: "Use /memory action:Clear to wipe your memory." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default memoryCommand;
