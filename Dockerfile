FROM node:22-alpine3.22 AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig*.json ./
COPY tsconfig ./tsconfig

RUN corepack prepare --activate
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm run build

# Production stage - uses assets from build stage to reduce image size
FROM node:22-alpine3.22

RUN apk add --update dumb-init

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app

# Copy package files and node_modules from build stage (includes compiled native modules)
COPY package.json pnpm-lock.yaml .npmrc ./
COPY --from=build /app/node_modules ./node_modules

# Prune devDependencies to reduce image size
RUN corepack enable && corepack prepare --activate
RUN pnpm prune --prod

COPY --from=build /app/dist ./dist

COPY entrypoint.js ./entrypoint.js

EXPOSE 2588
ENV AP_PORT=2588
ENV NODE_ENV=production
ENV NODE_OPTIONS="--import @opentelemetry/auto-instrumentations-node/register"

CMD ["node", "--enable-source-maps", "entrypoint.js"]

LABEL org.opencontainers.image.source=https://github.com/msonnb/fedisky
LABEL org.opencontainers.image.description="Fedisky - ActivityPub federation sidecar for ATProto PDS"
LABEL org.opencontainers.image.licenses=MIT
