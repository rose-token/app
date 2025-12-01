FROM node:20-alpine

# Install PostgreSQL and supervisord
RUN apk add --no-cache \
    postgresql16 \
    postgresql16-contrib \
    supervisor

# Create postgres data directory
RUN mkdir -p /var/lib/postgresql/data /run/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql /run/postgresql

# Create app directory
WORKDIR /app

# Copy and build node app
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm ci --only=production && npm cache clean --force

COPY src/config/whitelist.json ./dist/config/whitelist.json
COPY migrations ./migrations

# Copy supervisord config and scripts
COPY supervisord.conf /etc/supervisord.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY start-signer.sh /app/start-signer.sh
RUN chmod +x /docker-entrypoint.sh /app/start-signer.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
