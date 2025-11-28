# Multi-stage build: ceramic-one (Rust) + js-ceramic (Node)
FROM public.ecr.aws/r5b3e0r5/3box/ceramic-one:0.19.0 AS ceramic-one

FROM ceramicnetwork/js-ceramic:latest

USER root

# Install supervisord and curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor curl && \
    rm -rf /var/lib/apt/lists/*

# Copy ceramic-one binary from first stage
COPY --from=ceramic-one /usr/local/bin/ceramic-one /usr/local/bin/ceramic-one

# Create directories
RUN mkdir -p /data/ceramic-one /data/statestore /var/log /var/run && \
    chown -R root:root /data

# Copy configurations
COPY daemon.config.json /root/.ceramic/daemon.config.json
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy entrypoint
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy schemas for reference (deployed separately)
COPY schemas/ /app/schemas/

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -f http://localhost:7007/api/v0/node/healthcheck || exit 1

EXPOSE 7007
EXPOSE 5101

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
