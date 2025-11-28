#!/bin/sh
set -e

# Substitute CORS origins if provided
if [ -n "$CORS_ALLOWED_ORIGINS" ]; then
  ORIGINS_JSON=$(echo "$CORS_ALLOWED_ORIGINS" | sed 's/,/","/g' | sed 's/^/["/' | sed 's/$/"]/')
  sed -i "s|\"cors-allowed-origins\":.*|\"cors-allowed-origins\": $ORIGINS_JSON,|g" /root/.ceramic/daemon.config.json
fi

exec "$@"
