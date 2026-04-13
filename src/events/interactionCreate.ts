import type { Client, Collection } from "discord.js";
import type { MessageContextCommand, SlashCommand } from "../types/command";

function isUnknownInteractionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  const rawErrorCode = (error as { rawError?: { code?: unknown } }).rawError?.code;

  return maybeCode === 10062 || rawErrorCode === 10062;
}

async function handleInteractionCommand(
  interaction:
    | Parameters<SlashCommand["execute"]>[0]
    | Parameters<MessageContextCommand["execute"]>[0],
  execute: () => Promise<void>,
): Promise<void> {
  try {
    await execute();
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.warn("Ignored stale/unknown interaction (10062).", {
        command: interaction.commandName,
        userId: interaction.user.id,
      });
      return;
    }

    console.error("Interaction command execution failed:", error);

    const fallback = "Something went wrong while handling this command.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(fallback);
      } else {
        await interaction.reply({ content: fallback, ephemeral: true });
      }
    } catch (replyError) {
      if (!isUnknownInteractionError(replyError)) {
        console.error("Failed to send command error response:", replyError);
      }
    }
  }
}

export function registerInteractionCreateEvent(
  client: Client,
  slashCommandMap: Collection<string, SlashCommand>,
  contextCommandMap: Collection<string, MessageContextCommand>,
): void {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = slashCommandMap.get(interaction.commandName);
      if (!command) return;

      await handleInteractionCommand(interaction, () => command.execute(interaction));
      return;
    }

    if (interaction.isMessageContextMenuCommand()) {
      const command = contextCommandMap.get(interaction.commandName);
      if (!command) return;

      await handleInteractionCommand(interaction, () => command.execute(interaction));
    }
  });
}
