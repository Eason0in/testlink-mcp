# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

LABEL org.opencontainers.image.title="testlink-mcp" \
      org.opencontainers.image.description="AI-friendly, safety-first MCP server for TestLink 1.9.20" \
      org.opencontainers.image.source="https://github.com/Eason0in/testlink-mcp" \
      org.opencontainers.image.version="1.0.8" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app
# The runtime only executes Node. Package managers and their transitive code
# stay in the build stage and are removed from the runtime attack surface.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --chown=node:node package.json server.json LICENSE README.md ./

USER node
ENTRYPOINT ["node", "dist/cli.js"]
