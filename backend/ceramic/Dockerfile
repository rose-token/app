# Multi-stage build: ceramic-one (Rust) + js-ceramic (Node) + PostgreSQL
FROM public.ecr.aws/r5b3e0r5/3box/ceramic-one:0.56.0 AS ceramic-one

FROM ceramicnetwork/js-ceramic:latest

USER root

# Install supervisord, curl, nginx, and PostgreSQL
RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor curl git postgresql postgresql-contrib nginx && \
    rm -rf /var/lib/apt/lists/*

# Copy ceramic-one binary from first stage (binary is at /usr/bin in the source image)
COPY --from=ceramic-one /usr/bin/ceramic-one /usr/bin/ceramic-one

# Create directories
RUN mkdir -p /data/ceramic-one /data/statestore /data/postgres /var/log /var/run/postgresql /root/.ceramic-one /app/generated /app/composites /app/scripts && \
    chown -R root:root /data && \
    chown -R postgres:postgres /data/postgres /var/run/postgresql

# Initialize PostgreSQL database
USER postgres
RUN /usr/lib/postgresql/*/bin/initdb -D /data/postgres
USER root

# Copy configurations
COPY daemon.config.json /root/.ceramic/daemon.config.json
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy entrypoint and init script
COPY scripts/entrypoint.sh /entrypoint.sh
COPY scripts/init-postgres.sh /init-postgres.sh
RUN chmod +x /entrypoint.sh /init-postgres.sh

# Copy schemas
COPY schemas/ /app/schemas/

# Copy package.json and install ComposeDB devtools + express
COPY package.json /app/package.json
WORKDIR /app
RUN npm install --production

# Copy nginx config
COPY nginx.conf /app/nginx.conf

# Copy new scripts
COPY scripts/deploy-composites.sh /app/scripts/deploy-composites.sh
COPY scripts/definition-server.js /app/scripts/definition-server.js
RUN chmod +x /app/scripts/deploy-composites.sh

WORKDIR /root

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -f http://localhost:7007/api/v0/node/healthcheck || exit 1

EXPOSE 7007
EXPOSE 5101

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
