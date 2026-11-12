# syntax=docker/dockerfile:1

# Keep on the same major as .nvmrc.
FROM node:24-alpine AS base
WORKDIR /app

# --ignore-scripts skips Husky's git hook setup and mongodb-memory-server's
# MongoDB binary download, neither of which a build needs.
FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS deps
RUN --mount=type=cache,target=/root/.npm \
	--mount=type=bind,source=package.json,target=package.json \
	--mount=type=bind,source=package-lock.json,target=package-lock.json \
	npm ci --omit=dev --ignore-scripts

FROM base
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
# Run node directly, not npm, so SIGTERM reaches the graceful shutdown in index.ts.
CMD ["node", "dist/index.js"]
