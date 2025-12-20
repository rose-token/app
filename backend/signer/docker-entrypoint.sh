#!/bin/sh
set -e

# Use subdirectory to avoid lost+found on mount point
PGDATA=/var/lib/postgresql/data/pgdata

# Ensure the subdirectory exists and has correct ownership
mkdir -p "$PGDATA"
chown -R postgres:postgres /var/lib/postgresql/data

# Function to write secure pg_hba.conf
write_secure_pg_hba() {
    cat > "$PGDATA/pg_hba.conf" << 'EOF'
# PostgreSQL Client Authentication Configuration
# SECURITY HARDENED - scram-sha-256 authentication required
#
# TYPE  DATABASE  USER  ADDRESS       METHOD

# Local socket connections require password
local   all       all                 scram-sha-256

# IPv4 localhost connections require password
host    all       all   127.0.0.1/32  scram-sha-256

# IPv6 localhost connections require password
host    all       all   ::1/128       scram-sha-256

# Reject all other connections
host    all       all   0.0.0.0/0     reject
host    all       all   ::/0          reject
EOF
}

# Function to write security settings to postgresql.conf
write_security_settings() {
    cat >> "$PGDATA/postgresql.conf" << 'EOF'

# ===========================================
# SECURITY HARDENING (auto-configured)
# ===========================================

# Network - bind to localhost only
listen_addresses = 'localhost'
port = 5432

# Connection limits
max_connections = 20

# Authentication
password_encryption = 'scram-sha-256'

# Logging for security auditing
log_connections = on
log_disconnections = on
log_statement = 'ddl'

# SSL disabled (localhost only, overhead not needed)
ssl = off

# Data integrity
fsync = on
full_page_writes = on
EOF
}

# Initialize PostgreSQL if data directory is empty
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."

    # Require password for secure authentication
    if [ -z "$POSTGRES_PASSWORD" ]; then
        echo "ERROR: POSTGRES_PASSWORD is required for secure authentication"
        exit 1
    fi

    # Initialize with scram-sha-256 password encryption
    su postgres -c "initdb -D $PGDATA --auth-host=scram-sha-256 --auth-local=scram-sha-256"

    # Write secure pg_hba.conf
    write_secure_pg_hba

    # Add security settings to postgresql.conf
    write_security_settings

    # Start postgres temporarily with trust for initial user/db creation
    echo "local all all trust" > "$PGDATA/pg_hba.conf.init"
    su postgres -c "pg_ctl -D $PGDATA -o '-c listen_addresses=127.0.0.1 -c hba_file=$PGDATA/pg_hba.conf.init' start"
    sleep 2

    # Create user and database
    su postgres -c "createuser -s ${POSTGRES_USER:-rose}"
    su postgres -c "createdb -O ${POSTGRES_USER:-rose} ${POSTGRES_DB:-rose}"

    # Set password
    su postgres -c "psql -c \"ALTER USER ${POSTGRES_USER:-rose} PASSWORD '${POSTGRES_PASSWORD}';\""

    su postgres -c "pg_ctl -D $PGDATA stop"

    # Remove temporary trust config and restore secure config
    rm -f "$PGDATA/pg_hba.conf.init"
    write_secure_pg_hba

    echo "PostgreSQL initialized with security hardening."
else
    # MIGRATION: Check existing deployments for insecure config
    if grep -q "trust" "$PGDATA/pg_hba.conf" 2>/dev/null; then
        echo "SECURITY: Migrating pg_hba.conf from trust to scram-sha-256..."
        cp "$PGDATA/pg_hba.conf" "$PGDATA/pg_hba.conf.bak.$(date +%Y%m%d%H%M%S)"
        write_secure_pg_hba
        echo "SECURITY: pg_hba.conf migrated. Backup saved."
    fi

    # MIGRATION: Add security settings if missing
    if ! grep -q "SECURITY HARDENING" "$PGDATA/postgresql.conf" 2>/dev/null; then
        echo "SECURITY: Adding security hardening to postgresql.conf..."
        cp "$PGDATA/postgresql.conf" "$PGDATA/postgresql.conf.bak.$(date +%Y%m%d%H%M%S)"
        write_security_settings
        echo "SECURITY: postgresql.conf hardened. Backup saved."
    fi
fi

exec "$@"
