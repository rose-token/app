# check=skip=SecretsUsedInArgOrEnv

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build arguments - actual values passed at build time (not placeholders)
# These get baked into the bundle via Vite's import.meta.env
ARG VITE_TOKEN_ADDRESS
ARG VITE_TREASURY_ADDRESS
ARG VITE_MARKETPLACE_ADDRESS
ARG VITE_GOVERNANCE_ADDRESS
ARG VITE_REPUTATION_ADDRESS
ARG VITE_VROSE_ADDRESS
ARG VITE_USDC_ADDRESS
ARG VITE_PASSPORT_SIGNER_URL
ARG VITE_GITCOIN_SCORER_ID
ARG VITE_GITCOIN_API_KEY
ARG VITE_PINATA_GATEWAY
ARG VITE_PINATA_JWT
ARG VITE_BUILD_VERSION
ARG VITE_CHAIN_ID
ARG VITE_RPC_WS_URL

# Convert ARGs to ENV for Vite build process
ENV VITE_TOKEN_ADDRESS=${VITE_TOKEN_ADDRESS}
ENV VITE_TREASURY_ADDRESS=${VITE_TREASURY_ADDRESS}
ENV VITE_MARKETPLACE_ADDRESS=${VITE_MARKETPLACE_ADDRESS}
ENV VITE_GOVERNANCE_ADDRESS=${VITE_GOVERNANCE_ADDRESS}
ENV VITE_REPUTATION_ADDRESS=${VITE_REPUTATION_ADDRESS}
ENV VITE_VROSE_ADDRESS=${VITE_VROSE_ADDRESS}
ENV VITE_USDC_ADDRESS=${VITE_USDC_ADDRESS}
ENV VITE_PASSPORT_SIGNER_URL=${VITE_PASSPORT_SIGNER_URL}
ENV VITE_GITCOIN_SCORER_ID=${VITE_GITCOIN_SCORER_ID}
ENV VITE_GITCOIN_API_KEY=${VITE_GITCOIN_API_KEY}
ENV VITE_PINATA_GATEWAY=${VITE_PINATA_GATEWAY}
ENV VITE_PINATA_JWT=${VITE_PINATA_JWT}
ENV VITE_BUILD_VERSION=${VITE_BUILD_VERSION}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}
ENV VITE_RPC_WS_URL=${VITE_RPC_WS_URL}

# Build hash for cache busting - ensures new bundle hashes on every deploy
ARG VITE_BUILD_HASH
ENV VITE_BUILD_HASH=${VITE_BUILD_HASH}

# Clear any Vite cache and build fresh
RUN rm -rf node_modules/.vite .vite && npm run build

# Serve stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
