# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS dependencias
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json demo.ts ./
COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
COPY scripts ./scripts
COPY modulo ./modulo

# El mismo módulo que se entrega como bonus se genera y valida en el build.
RUN bun run build:modulo && bun run check:modulo

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["bun", "run", "src/server.ts"]
