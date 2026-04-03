FROM oven/bun:1 AS base
WORKDIR /app

# ---- Install dependencies ----
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- Build ----
FROM deps AS build
COPY . .
RUN bun run site:build
RUN bun run build

# ---- Runtime ----
FROM base
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/site/dist ./site/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/config.toml ./
COPY --from=build /app/SOUL.md ./
COPY --from=build /app/constitution.md ./

VOLUME /mnt/disks/userdata

ENV NODE_ENV=production
ENV DATA_DIR=/mnt/disks/userdata

EXPOSE 3000

CMD ["bun", "dist/main.js"]
