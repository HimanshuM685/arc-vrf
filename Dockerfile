# Arc VRF: one image, two roles (see docker-compose.yml).
#   web       node apps/web/server.js   (default)  Next.js dashboard, stateless, scale freely
#   vrf-node  node vrf-node.mjs                    the VRF oracle, run exactly one
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY node/package.json node/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web... --filter @arc-vrf/node...
COPY packages/sdk packages/sdk
COPY node node
COPY apps/web apps/web
# Public (browser) settings are baked in at build time.
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
ARG NEXT_PUBLIC_ARC_TESTNET_RPC=
ARG NEXT_PUBLIC_ARC_MAINNET_RPC=
RUN pnpm --filter web build && pnpm --filter @arc-vrf/node build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/node/dist/vrf-node.mjs ./vrf-node.mjs
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
