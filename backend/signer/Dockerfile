# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Copy config directory to dist (for whitelist.json)
RUN mkdir -p dist/config && cp -r src/config/* dist/config/ 2>/dev/null || true

# Production stage
FROM node:20-alpine

WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
