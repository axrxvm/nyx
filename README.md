# Nyx

Nyx is an AI assistant for Discord. Mention Nyx in any chat to ask questions, explain messages, summarize conversations, generate replies, or create images instantly. It supports servers, bot DMs, and group DMs with slash commands, message actions, smart context awareness, and fast, reliable responses.

Add it to your discord: [Nyx - Discord](https://discord.com/oauth2/authorize?client_id=1478656527970603132)

## Setup

- Install dependencies:

```bash
bun install
```

- Configure environment variables by copying `.env.example` to `.env` and filling values:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `ALABS_API_KEY`
- `ALABS_AI_BASE_URL`
- `OPENAI_KEY` (optional fallback)
- `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, ... (optional fallback keys)

- Start the bot:

```bash
bun run start
```

## Scripts

- `bun run check` — TypeScript typecheck
- `bun run build:dist` — Build distributable output

## Open-source notes

- Do not commit `.env` or secrets.
- The ALABS AI SDK is OpenAI-API Compliant, so you should be able to use OpenAI AI SDK without changing the code.
