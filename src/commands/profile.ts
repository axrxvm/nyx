import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../types/command";
import {
  clearUserProfile,
  getUserProfile,
  upsertUserProfile,
} from "../services/profile";
import { makeBaseEmbed } from "../utils/embeds";

const profileCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Manage your Nyx companion profile")
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
        .setName("view")
        .setDescription("View your current companion profile"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Update your companion profile preferences")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("How Nyx should address you")
            .setMaxLength(60)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("tone")
            .setDescription("Preferred response style (e.g. direct, warm, analytical)")
            .setMaxLength(160)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("goals")
            .setDescription("What Nyx should optimize for when helping you")
            .setMaxLength(500)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reset")
        .setDescription("Delete your companion profile"),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "reset") {
      const deleted = await clearUserProfile(interaction.user.id);
      await interaction.reply({
        content: deleted
          ? "Your companion profile has been reset."
          : "No saved companion profile was found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "view") {
      const profile = await getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.reply({
          content: "No profile found yet. Use `/profile set` to personalize Nyx.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = makeBaseEmbed("Nyx • Companion Profile", "Personalization currently applied")
        .addFields(
          {
            name: "Name",
            value: profile.displayName ?? "Not set",
            inline: true,
          },
          {
            name: "Tone",
            value: profile.tone ?? "Not set",
            inline: true,
          },
          {
            name: "Goals",
            value: profile.goals ?? "Not set",
            inline: false,
          },
          {
            name: "Updated",
            value: `<t:${Math.floor(profile.updatedAt / 1000)}:R>`,
            inline: true,
          },
        )
        .setFooter({ text: "Use /profile reset to remove personalization." });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const name = interaction.options.getString("name") ?? undefined;
    const tone = interaction.options.getString("tone") ?? undefined;
    const goals = interaction.options.getString("goals") ?? undefined;

    if (!name && !tone && !goals) {
      await interaction.reply({
        content: "Provide at least one field: `name`, `tone`, or `goals`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const profile = await upsertUserProfile(interaction.user.id, {
      displayName: name,
      tone,
      goals,
    });

    const embed = makeBaseEmbed("Nyx • Companion Profile Updated")
      .addFields(
        {
          name: "Name",
          value: profile.displayName ?? "Not set",
          inline: true,
        },
        {
          name: "Tone",
          value: profile.tone ?? "Not set",
          inline: true,
        },
        {
          name: "Goals",
          value: profile.goals ?? "Not set",
          inline: false,
        },
      )
      .setFooter({ text: "Nyx now uses this profile to personalize future replies." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default profileCommand;
