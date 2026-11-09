ARG NODE_IMAGE=node:24-bookworm-slim
ARG NODE_BUILD_IMAGE=node:24-bookworm
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app
RUN python3 --version && make --version && g++ --version
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm test && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/textrelay.db COOKIE_SECURE=true
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 3000
CMD ["node","dist/server/index.js"]
