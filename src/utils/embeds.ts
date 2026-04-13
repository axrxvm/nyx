import { EmbedBuilder } from "discord.js";

export function makeBaseEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description ?? null)
    .setTimestamp(new Date());
}
