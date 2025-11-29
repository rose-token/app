#!/bin/sh
set -e

# Ensure required directories exist (persistent volume may be empty on first run)
mkdir -p /data/ceramic-one /data/statestore /data/postgres /root/.ceramic-one
chown -R postgres:postgres /data/postgres

# Initialize PostgreSQL if data directory is empty
if [ ! -f /data/postgres/PG_VERSION ]; then
  echo "Initializing PostgreSQL database..."
  su postgres -c "/usr/lib/postgresql/*/bin/initdb -D /data/postgres"
fi

CONFIG_FILE="/root/.ceramic/daemon.config.json"

# Substitute CORS origins if provided
if [ -n "$CORS_ALLOWED_ORIGINS" ]; then
  ORIGINS_JSON=$(echo "$CORS_ALLOWED_ORIGINS" | sed 's/,/","/g' | sed 's/^/["/' | sed 's/$/"]/')
  sed -i "s|\"cors-allowed-origins\": \[[^]]*\]|\"cors-allowed-origins\": $ORIGINS_JSON|g" "$CONFIG_FILE"
fi

# Substitute Admin DID (for admin API access)
if [ -n "$CERAMIC_ADMIN_DID" ]; then
  sed -i "s|PLACEHOLDER_ADMIN_DID|$CERAMIC_ADMIN_DID|g" "$CONFIG_FILE"
else
  echo "WARNING: CERAMIC_ADMIN_DID not set - admin API will be disabled"
  sed -i 's|"admin-dids": \["PLACEHOLDER_ADMIN_DID"\]|"admin-dids": []|g' "$CONFIG_FILE"
fi

# Substitute Ethereum RPC URL (required for mainnet anchor verification)
if [ -n "$ETHEREUM_RPC_URL" ]; then
  sed -i "s|PLACEHOLDER_ETH_RPC_URL|$ETHEREUM_RPC_URL|g" "$CONFIG_FILE"
  # Export for ceramic-one (expects CERAMIC_ONE_ETHEREUM_RPC_URLS env var)
  export CERAMIC_ONE_ETHEREUM_RPC_URLS="$ETHEREUM_RPC_URL"
else
  echo "ERROR: ETHEREUM_RPC_URL not set - ceramic-one requires this for mainnet"
  exit 1
fi

# Substitute Node Private Seed URL (required for CAS authentication)
if [ -n "$CERAMIC_ADMIN_PRIVATE_KEY" ]; then
  SEED_URL="inplace:ed25519#$CERAMIC_ADMIN_PRIVATE_KEY"
  sed -i "s|PLACEHOLDER_PRIVATE_SEED_URL|$SEED_URL|g" "$CONFIG_FILE"
else
  echo "WARNING: CERAMIC_ADMIN_PRIVATE_KEY not set - node will generate random identity"
  # Remove the placeholder line so js-ceramic generates a random seed
  sed -i 's|"privateSeedUrl": "PLACEHOLDER_PRIVATE_SEED_URL"||g' "$CONFIG_FILE"
fi

exec "$@"
