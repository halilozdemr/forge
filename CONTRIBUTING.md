# Contributing to Forge

Thank you for your interest in contributing. Here is everything you need to get started.

## Development setup

**Prerequisites:**
- Node.js 18+
- At least one of: Claude Code CLI, Gemini CLI, or an API key for OpenRouter / Anthropic

```bash
git clone https://github.com/halilozdemr/forge.git
cd forge
npm install
cp .env.example .env   # fill in any API keys you want to use
npm run dev            # start forge in dev mode (no build required)
```

## Project structure

```
src/          TypeScript source
  cli/        CLI command handlers
  server/     Fastify REST API
  bridge/     Job worker + AI runner abstractions
  orchestrator/  Pipeline definitions
  mcp/        MCP server (forge-mcp)
  db/         Prisma client, schema, seeds
webui/        Vite + vanilla TS single-page app
prisma/       Database schema and migrations
ai-system/    Agent prompt and output contract layer
scripts/      One-off migration and seed scripts
```

## Running tests

```bash
npm run test    # vitest unit tests
npm run lint    # TypeScript type-check (no emit)
```

## Making changes

1. Fork the repository and create a branch: `git checkout -b feat/your-feature`
2. Make your changes and ensure `npm run lint` passes.
3. Add or update tests where appropriate.
4. Open a pull request against `main`.

## Adding a new AI runner provider

1. Create `src/bridge/runners/your-provider.ts` implementing the `Runner` interface.
2. Register it in `src/bridge/runners/factory.ts`.
3. Add the provider key to the README runner table.

## Database schema changes

```bash
# Edit prisma/schema.prisma, then:
npm run db:migrate   # create a migration (requires interactive TTY)
npm run db:generate  # regenerate Prisma client
```

## Pull request guidelines

- Keep PRs focused — one logical change per PR.
- Write a clear title and description.
- Reference any related issues.
- Ensure CI passes (lint + tests).

## Reporting issues

Use the GitHub issue templates. For bugs, include:
- Forge version (`forge --version`)
- Node.js version (`node --version`)
- Which AI runner provider you are using
- The full error output

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Please be respectful.
