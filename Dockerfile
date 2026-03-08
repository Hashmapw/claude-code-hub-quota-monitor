ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
ENV NEXT_TELEMETRY_DISABLED=1

RUN set -eux; \
  getent group nodejs >/dev/null || groupadd --system --gid 1001 nodejs; \
  id -u nextjs >/dev/null 2>&1 || useradd --system --uid 1001 --gid nodejs nextjs

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY .env.example ./.env.example
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Always start from an empty data directory, even if the base image already contains old SQLite files.
RUN set -eux; \
  rm -rf /app/data; \
  install -d -o nextjs -g nodejs -m 0755 /app/data

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 3010
ENTRYPOINT ["docker-entrypoint.sh"]
