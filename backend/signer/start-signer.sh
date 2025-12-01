#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."

MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if pg_isready -h localhost -p 5432 -U ${POSTGRES_USER:-rose} > /dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "Attempt $ATTEMPT/$MAX_ATTEMPTS: PostgreSQL not ready, waiting..."
    sleep 1
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "ERROR: PostgreSQL did not become ready in time"
    exit 1
fi

echo "Starting signer service..."
exec node /app/dist/index.js
