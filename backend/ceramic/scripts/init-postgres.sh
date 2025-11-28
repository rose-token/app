#!/bin/bash
set -e

# Wait for PostgreSQL to be ready
until pg_isready -h localhost -U postgres; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done

# Create database and user if they don't exist
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'ceramic'" | grep -q 1 || \
  psql -U postgres -c "CREATE DATABASE ceramic;"

psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname = 'ceramic'" | grep -q 1 || \
  psql -U postgres -c "CREATE USER ceramic WITH PASSWORD 'ceramic';"

psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ceramic TO ceramic;"
psql -U postgres -d ceramic -c "GRANT ALL ON SCHEMA public TO ceramic;"

echo "PostgreSQL initialized successfully"
