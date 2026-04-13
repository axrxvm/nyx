import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { appConfig } from "./config";
import askCommand from "./commands/ask";
import summarizeCommand from "./commands/summarize";
import imagineCommand from "./commands/imagine";
import helpCommand from "./commands/help";
import commandsCommand from "./commands/commands";
import privacyCommand from "./commands/privacy";
import tosCommand from "./commands/tos";
import pingCommand from "./commands/ping";
import botInfoCommand from "./commands/botinfo";
import statusCommand from "./commands/status";
import memoryCommand from "./commands/memory";
import profileCommand from "./commands/profile";
import coachCommand from "./commands/coach";
import modelsCommand from "./commands/models";
import ocrCommand from "./commands/ocr";
import moderateCommand from "./commands/moderate";
import searchCommand from "./commands/search";
import setChannelCommand from "./commands/setchannel";
import newsCommand from "./commands/news";
import summarizeContextCommand from "./context/summarize";
import explainContextCommand from "./context/explain";
import replyContextCommand from "./context/reply";
import imagineContextCommand from "./context/imagine";
import type { MessageContextCommand, SlashCommand } from "./types/command";
import { registerReadyEvent } from "./events/ready";
import { registerInteractionCreateEvent } from "./events/interactionCreate";
import { registerMessageCreateEvent } from "./events/messageCreate";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const slashCommands: SlashCommand[] = [
  askCommand,
  summarizeCommand,
  imagineCommand,
  helpCommand,
  commandsCommand,
  privacyCommand,
  tosCommand,
  pingCommand,
  botInfoCommand,
  statusCommand,
  memoryCommand,
  profileCommand,
  coachCommand,
  modelsCommand,
  ocrCommand,
  moderateCommand,
  searchCommand,
  newsCommand,
  setChannelCommand,
];

const contextCommands: MessageContextCommand[] = [
  summarizeContextCommand,
  explainContextCommand,
  replyContextCommand,
  imagineContextCommand,
];

const slashCommandMap = new Collection<string, SlashCommand>(
  slashCommands.map((command) => [command.data.name, command]),
);

const contextCommandMap = new Collection<string, MessageContextCommand>(
  contextCommands.map((command) => [command.data.name, command]),
);

registerReadyEvent(client, slashCommands, contextCommands);
registerInteractionCreateEvent(client, slashCommandMap, contextCommandMap);
registerMessageCreateEvent(client);

client.login(appConfig.discordToken).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
