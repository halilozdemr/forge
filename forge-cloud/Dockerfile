# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/webui
COPY webui/package*.json ./
RUN npm ci || npm install
COPY webui/ ./
RUN npm run build

# Build backend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci || npm install
RUN npx prisma generate
COPY tsconfig.json .
COPY src ./src
RUN npm run build

# Final image
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev || npm install --omit=dev
RUN npx prisma generate
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/webui/dist ./webui/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
