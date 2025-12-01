#!/bin/sh
set -e

# Use subdirectory to avoid lost+found on mount point
PGDATA=/var/lib/postgresql/data/pgdata

# Ensure the subdirectory exists and has correct ownership
mkdir -p "$PGDATA"
chown -R postgres:postgres /var/lib/postgresql/data

# Initialize PostgreSQL if data directory is empty
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."
    su postgres -c "initdb -D $PGDATA"

    # Configure pg_hba.conf for local trust
    echo "local all all trust" > "$PGDATA/pg_hba.conf"
    echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
    echo "host all all ::1/128 trust" >> "$PGDATA/pg_hba.conf"

    # Start postgres temporarily to create user/db
    su postgres -c "pg_ctl -D $PGDATA -o '-c listen_addresses=127.0.0.1' start"
    sleep 2

    # Create user and database
    su postgres -c "createuser -s ${POSTGRES_USER:-rose}"
    su postgres -c "createdb -O ${POSTGRES_USER:-rose} ${POSTGRES_DB:-rose}"

    # Set password if provided
    if [ -n "$POSTGRES_PASSWORD" ]; then
        su postgres -c "psql -c \"ALTER USER ${POSTGRES_USER:-rose} PASSWORD '${POSTGRES_PASSWORD}';\""
    fi

    su postgres -c "pg_ctl -D $PGDATA stop"
    echo "PostgreSQL initialized."
fi

exec "$@"
