# syntax=docker/dockerfile:1.7
FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

LABEL org.opencontainers.image.title="testlink-mcp" \
      org.opencontainers.image.description="AI-friendly, safety-first MCP server for TestLink 1.9.20" \
      org.opencontainers.image.source="https://github.com/easonlin/testlink-mcp" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app
# The runtime only executes Node. Removing npm also removes package-manager-only
# transitive code from the attack surface; builds and installs stay in `build`.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --chown=node:node package.json server.json LICENSE README.md ./

USER node
ENTRYPOINT ["node", "dist/cli.js"]
