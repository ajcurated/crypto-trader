FROM node:22-bookworm-slim

WORKDIR /app

# Build tools for the better-sqlite3 native module (used if no prebuilt binary
# exists for the target architecture).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# SQLite lives on a mounted volume so the track record survives restarts.
ENV DB_PATH=/data/crypto-markets.sqlite
ENV PORT=8080
VOLUME /data
EXPOSE 8080

# One process: daily cycle + streaming risk loop + live dashboard.
CMD ["pnpm", "app"]
