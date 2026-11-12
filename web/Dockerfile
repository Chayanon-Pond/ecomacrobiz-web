# syntax=docker/dockerfile:1
# ECOMACROBIZ web (Next.js 16, output: "standalone").
#   docker build -t escoma-web \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://www.ecomacrobiz.com \
#     --build-arg NEXT_PUBLIC_MEDIA_ORIGIN=https://api.ecomacrobiz.com ./web
# Railway passes service variables to the build only for the ARGs declared
# below. API_URL is intentionally NOT a build arg: the private network does not
# exist at build time, so the build prerenders the bundled posts with a short
# cache lifetime and the running server refreshes them from the API.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
# Inlined into the client bundle / next.config at build time.
ARG NEXT_PUBLIC_SITE_URL=https://www.ecomacrobiz.com
ARG NEXT_PUBLIC_MEDIA_ORIGIN=
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_MEDIA_ORIGIN=${NEXT_PUBLIC_MEDIA_ORIGIN} \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 # Keep only the musl (Alpine) sharp binaries the runner can load (-27 MB).
 && find .next/standalone/node_modules/@img -mindepth 1 -maxdepth 1 \
      ! -name colour ! -name '*linuxmusl*' -exec rm -rf {} +

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=::
# Standalone server + static assets (server.js serves public/ and .next/static).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The ISR / 'use cache' / image cache lives in .next/cache: must be writable.
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
# HOSTNAME=:: listens on IPv6 + IPv4 (Railway private network is IPv6 in
# older environments). PORT is injected by Railway.
CMD ["node", "server.js"]
