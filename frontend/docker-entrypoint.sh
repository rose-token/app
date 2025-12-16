#!/bin/sh
set -e

echo "Frontend entrypoint: Replacing placeholders with runtime env vars..."

# Find all JS files in the build directory
BUILD_DIR="/usr/share/nginx/html"

# Process all JS files (including those in subdirectories like assets/)
JS_FILES=$(find "$BUILD_DIR" -type f -name "*.js" 2>/dev/null || true)

if [ -z "$JS_FILES" ]; then
  echo "Warning: No JS files found in $BUILD_DIR"
else
  for file in $JS_FILES; do
    # Contract addresses
    sed -i "s|__VITE_TOKEN_ADDRESS__|${VITE_TOKEN_ADDRESS}|g" "$file"
    sed -i "s|__VITE_TREASURY_ADDRESS__|${VITE_TREASURY_ADDRESS}|g" "$file"
    sed -i "s|__VITE_MARKETPLACE_ADDRESS__|${VITE_MARKETPLACE_ADDRESS}|g" "$file"
    sed -i "s|__VITE_GOVERNANCE_ADDRESS__|${VITE_GOVERNANCE_ADDRESS}|g" "$file"
    sed -i "s|__VITE_REPUTATION_ADDRESS__|${VITE_REPUTATION_ADDRESS}|g" "$file"
    sed -i "s|__VITE_VROSE_ADDRESS__|${VITE_VROSE_ADDRESS}|g" "$file"
    sed -i "s|__VITE_USDC_ADDRESS__|${VITE_USDC_ADDRESS}|g" "$file"

    # API/Config
    sed -i "s|__VITE_PASSPORT_SIGNER_URL__|${VITE_PASSPORT_SIGNER_URL}|g" "$file"
    sed -i "s|__VITE_GITCOIN_SCORER_ID__|${VITE_GITCOIN_SCORER_ID}|g" "$file"
    sed -i "s|__VITE_GITCOIN_API_KEY__|${VITE_GITCOIN_API_KEY}|g" "$file"
    sed -i "s|__VITE_PINATA_GATEWAY__|${VITE_PINATA_GATEWAY}|g" "$file"
    sed -i "s|__VITE_PINATA_JWT__|${VITE_PINATA_JWT}|g" "$file"
    sed -i "s|__VITE_BUILD_VERSION__|${VITE_BUILD_VERSION}|g" "$file"

    # Chain configuration
    sed -i "s|__VITE_CHAIN_ID__|${VITE_CHAIN_ID}|g" "$file"
    sed -i "s|__VITE_RPC_WS_URL__|${VITE_RPC_WS_URL}|g" "$file"
  done

  echo "Placeholder replacement complete for $(echo "$JS_FILES" | wc -l | tr -d ' ') JS files."
fi

# Verify no unreplaced placeholders remain (optional check)
REMAINING=$(grep -roh "__VITE_[A-Z_]*__" "$BUILD_DIR" 2>/dev/null | sort | uniq || true)
if [ -n "$REMAINING" ]; then
  echo "Warning: Unreplaced placeholders found:"
  echo "$REMAINING"
fi

# Execute the main command (nginx)
exec "$@"
