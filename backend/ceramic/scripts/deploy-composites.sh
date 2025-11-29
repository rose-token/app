#!/bin/bash
set -e

# Internal Ceramic URL (nginx proxies 7007 -> 7017)
CERAMIC_URL="${CERAMIC_URL:-http://localhost:7017}"
SCHEMAS_DIR="/app/schemas"
COMPOSITES_DIR="/app/composites"
GENERATED_DIR="/app/generated"

echo "=== ComposeDB Composite Deployment ==="
echo "Ceramic URL: $CERAMIC_URL"
echo "Schemas dir: $SCHEMAS_DIR"

mkdir -p "$COMPOSITES_DIR" "$GENERATED_DIR"

# Wait for Ceramic to be ready
echo "Waiting for Ceramic to be ready..."
MAX_RETRIES=60
RETRY_COUNT=0
until curl -s "$CERAMIC_URL/api/v0/node/healthcheck" > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Ceramic did not become ready after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "  Waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep 5
done
echo "Ceramic is ready!"

# Check for admin private key
if [ -z "$CERAMIC_ADMIN_PRIVATE_KEY" ]; then
  echo "ERROR: CERAMIC_ADMIN_PRIVATE_KEY environment variable not set"
  exit 1
fi

# Create composites from each schema
echo ""
echo "Creating composites from schemas..."
for schema in "$SCHEMAS_DIR"/*.graphql; do
  if [ -f "$schema" ]; then
    name=$(basename "$schema" .graphql)
    echo "  Creating composite: $name"
    npx composedb composite:create "$schema" \
      --output "$COMPOSITES_DIR/$name.json" \
      --ceramic-url "$CERAMIC_URL" \
      --did-private-key "$CERAMIC_ADMIN_PRIVATE_KEY" || {
        echo "  WARNING: Failed to create composite for $name, skipping..."
        continue
      }
    echo "  Created: $COMPOSITES_DIR/$name.json"
  fi
done

# Check if we have any composites
COMPOSITE_COUNT=$(ls -1 "$COMPOSITES_DIR"/*.json 2>/dev/null | wc -l)
if [ "$COMPOSITE_COUNT" -eq 0 ]; then
  echo "ERROR: No composites were created"
  exit 1
fi

echo ""
echo "Created $COMPOSITE_COUNT composite(s)"

# Merge all composites
echo ""
echo "Merging composites..."
npx composedb composite:merge "$COMPOSITES_DIR"/*.json \
  --output "$COMPOSITES_DIR/merged.json"
echo "Merged composite: $COMPOSITES_DIR/merged.json"

# Deploy to Ceramic
echo ""
echo "Deploying composite to Ceramic..."
npx composedb composite:deploy "$COMPOSITES_DIR/merged.json" \
  --ceramic-url "$CERAMIC_URL" \
  --did-private-key "$CERAMIC_ADMIN_PRIVATE_KEY"
echo "Composite deployed!"

# Generate runtime definition as JSON (for API)
echo ""
echo "Generating runtime definition..."
npx composedb composite:compile "$COMPOSITES_DIR/merged.json" \
  "$GENERATED_DIR/definition.json"
echo "Runtime definition: $GENERATED_DIR/definition.json"

echo ""
echo "=== Composites deployed successfully! ==="
