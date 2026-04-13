import { ActivityType, REST, Routes, type Client } from "discord.js";
import type { MessageContextCommand, SlashCommand } from "../types/command";
import { appConfig } from "../config";

export function registerReadyEvent(
  client: Client,
  slashCommands: SlashCommand[],
  contextCommands: MessageContextCommand[],
): void {
  client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    client.user?.setPresence({
      status: "online",
      activities: [
        {
          name: "Discord chats • /help",
          type: ActivityType.Playing,
        },
      ],
    });

    const rest = new REST({ version: "10" }).setToken(appConfig.discordToken);
    const allCommands = [...slashCommands, ...contextCommands].map((command) =>
      command.data.toJSON(),
    );

    try {
      await rest.put(Routes.applicationCommands(appConfig.clientId), {
        body: allCommands,
      });
      console.log("Registered application commands.");
    } catch (error) {
      console.error("Failed to register commands:", error);
    }
  });
}
