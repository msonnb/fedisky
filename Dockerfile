FROM node:22-alpine3.22 as build

RUN corepack enable

# Move files into the image and install
WORKDIR /app
COPY ./service ./
RUN corepack prepare --activate
RUN pnpm install --production --frozen-lockfile > /dev/null

# Uses assets from build stage to reduce build size
FROM node:22-alpine3.22

RUN apk add --update dumb-init

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app
COPY --from=build /app /app

EXPOSE 2588
ENV AP_PORT=2588
ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "index.js"]

LABEL org.opencontainers.image.source=https://github.com/msonnb/fedisky
LABEL org.opencontainers.image.description="Fedisky - ActivityPub federation sidecar for ATProto PDS"
LABEL org.opencontainers.image.licenses=MIT
