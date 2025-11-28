FROM ceramicnetwork/js-ceramic:latest

USER root

# Install curl for healthcheck (Debian-based image, not Alpine)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy configuration
COPY daemon.config.json /root/.ceramic/daemon.config.json

# Copy entrypoint
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data directory with proper permissions
RUN mkdir -p /data/statestore && chown -R node:node /data

# Copy schemas for reference (deployed separately)
COPY schemas/ /app/schemas/

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:7007/api/v0/node/healthcheck || exit 1

USER node
EXPOSE 7007

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "/js-ceramic/packages/cli/bin/ceramic.js", "daemon"]
