#!/bin/sh
set -e

CONFIG_FILE="/root/.ceramic/daemon.config.json"

# Substitute CORS origins if provided
if [ -n "$CORS_ALLOWED_ORIGINS" ]; then
  ORIGINS_JSON=$(echo "$CORS_ALLOWED_ORIGINS" | sed 's/,/","/g' | sed 's/^/["/' | sed 's/$/"]/')
  sed -i "s|\"cors-allowed-origins\":.*|\"cors-allowed-origins\": $ORIGINS_JSON,|g" "$CONFIG_FILE"
fi

# Substitute Admin DID (for admin API access)
if [ -n "$CERAMIC_ADMIN_DID" ]; then
  sed -i "s|PLACEHOLDER_ADMIN_DID|$CERAMIC_ADMIN_DID|g" "$CONFIG_FILE"
else
  echo "WARNING: CERAMIC_ADMIN_DID not set - admin API will be disabled"
  sed -i 's|"admin-dids": \["PLACEHOLDER_ADMIN_DID"\]|"admin-dids": []|g' "$CONFIG_FILE"
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
