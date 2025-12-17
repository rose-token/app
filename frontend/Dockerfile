# check=skip=SecretsUsedInArgOrEnv

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Set placeholder values for Vite env vars
# These will be replaced at runtime by docker-entrypoint.sh
ENV VITE_TOKEN_ADDRESS=__VITE_TOKEN_ADDRESS__
ENV VITE_TREASURY_ADDRESS=__VITE_TREASURY_ADDRESS__
ENV VITE_MARKETPLACE_ADDRESS=__VITE_MARKETPLACE_ADDRESS__
ENV VITE_GOVERNANCE_ADDRESS=__VITE_GOVERNANCE_ADDRESS__
ENV VITE_REPUTATION_ADDRESS=__VITE_REPUTATION_ADDRESS__
ENV VITE_VROSE_ADDRESS=__VITE_VROSE_ADDRESS__
ENV VITE_USDC_ADDRESS=__VITE_USDC_ADDRESS__
ENV VITE_PASSPORT_SIGNER_URL=__VITE_PASSPORT_SIGNER_URL__
ENV VITE_GITCOIN_SCORER_ID=__VITE_GITCOIN_SCORER_ID__
ENV VITE_GITCOIN_API_KEY=__VITE_GITCOIN_API_KEY__
ENV VITE_PINATA_GATEWAY=__VITE_PINATA_GATEWAY__
ENV VITE_PINATA_JWT=__VITE_PINATA_JWT__
ENV VITE_BUILD_VERSION=__VITE_BUILD_VERSION__
ENV VITE_CHAIN_ID=__VITE_CHAIN_ID__
ENV VITE_RPC_WS_URL=__VITE_RPC_WS_URL__

# Cache bust arg - changes with each commit to invalidate cached npm/Vite output
ARG CACHE_BUST
RUN echo "Cache bust: ${CACHE_BUST}"

# Build the app (--force skips Vite dependency optimization cache)
RUN npx vite build --force

# Serve stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script for runtime env var injection
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
