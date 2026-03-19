# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src
COPY bin ./bin

RUN npm run db:generate
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────
FROM node:22-alpine AS runner

# OpenSSL required by Prisma on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Only production deps + prisma CLI for migrations
COPY package*.json ./
RUN npm ci --omit=dev && npm install prisma

# Copy compiled output + prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Scaffold templates (runtime needs these for `forge init`)
COPY src/scaffold/templates ./dist/scaffold/templates
# Agent default prompts
COPY src/agents/defaults ./dist/agents/defaults

ENV NODE_ENV=production

EXPOSE 3131

CMD ["node", "dist/bin/forge.js", "start"]
