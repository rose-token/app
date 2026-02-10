FROM node:20-slim

# Install PostgreSQL 16 (via PGDG repo) and supervisord
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
      gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      postgresql-16 \
      postgresql-contrib-16 \
      supervisor && \
    rm -rf /var/lib/apt/lists/*

# Add PostgreSQL 16 bin to PATH (initdb, pg_ctl, pg_isready, etc.)
ENV PATH="/usr/lib/postgresql/16/bin:$PATH"

# Create postgres data directory (using subdirectory to avoid lost+found on mount)
RUN mkdir -p /var/lib/postgresql/data/pgdata /run/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql /run/postgresql

# Create app directory
WORKDIR /app

# Copy and build node app
COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm install --only=production && npm cache clean --force

COPY src/config/whitelist.json ./dist/config/whitelist.json
COPY migrations ./migrations
COPY SKILL.md /app/SKILL.md

# Copy supervisord config and scripts
COPY supervisord.conf /etc/supervisord.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY start-signer.sh /app/start-signer.sh
RUN chmod +x /docker-entrypoint.sh /app/start-signer.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
