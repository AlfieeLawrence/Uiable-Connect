# Uiable Connect (web) for Docker Desktop / any Docker host. Same UI as the desktop app, served by a small Node server.
#   docker compose up -d   then open http://localhost:8484
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# runtime deps only (ssh2 + xterm); no install scripts (ssh2's optional native addon isn't needed)
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf node_modules/@xterm/*/src node_modules/@xterm/*/typings

FROM node:26-alpine
RUN apk add --no-cache tar && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY src ./src
COPY server ./server
ENV NODE_ENV=production UC_DATA=/data PORT=8484 UC_FWD_BIND=0.0.0.0 NODE_OPTIONS="--max-old-space-size=96"
USER node
VOLUME ["/data"]
EXPOSE 8484 8080-8090
HEALTHCHECK --interval=5m --timeout=5s --start-period=10s CMD wget -qO- --header 'Host: localhost' http://127.0.0.1:8484/base.css >/dev/null || exit 1
CMD ["node", "server/server.js"]
