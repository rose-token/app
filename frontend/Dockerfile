# check=skip=SecretsUsedInArgOrEnv

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build args for Vite env vars (baked in at build time)
ARG VITE_TOKEN_ADDRESS
ARG VITE_TREASURY_ADDRESS
ARG VITE_MARKETPLACE_ADDRESS
ARG VITE_GOVERNANCE_ADDRESS
ARG VITE_REPUTATION_ADDRESS
ARG VITE_VROSE_ADDRESS
ARG VITE_USDC_ADDRESS
ARG VITE_BUILD_VERSION
ARG VITE_PINATA_JWT
ARG VITE_PINATA_GATEWAY
ARG VITE_PASSPORT_SIGNER_URL
ARG VITE_GITCOIN_SCORER_ID
ARG VITE_GITCOIN_API_KEY

# Build the app
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
