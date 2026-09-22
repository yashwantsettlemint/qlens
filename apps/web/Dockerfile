# Build from the repo root:  docker build -f apps/web/Dockerfile .
#
# infra/docker-compose.yml already passes --build-arg NEXT_PUBLIC_AUTH_URL
# correctly (see its web service's build.args). infra/k8s/services.yaml's
# `web` Deployment pulls a pre-built ${REGISTRY}/web:${TAG} image instead —
# whoever builds/pushes that image for a real k8s deploy MUST pass
# --build-arg NEXT_PUBLIC_AUTH_URL=<value from infra/k8s/configmap.yaml>
# (currently http://auth-service:8005). The configmap's copy of that var is
# NOT enough on its own — see the ARG note below for why.
FROM node:20-slim AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci
COPY apps/web ./
# NEXT_PUBLIC_* vars are inlined into the compiled output at build time by
# Next.js — including in server-only code, since the same webpack pass
# compiles both. Setting it only at container runtime (docker-compose
# environment:) has no effect; it must be a build arg.
ARG NEXT_PUBLIC_AUTH_URL
ENV NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL
# codegen needs a schema file present but not a live Hasura — schema.graphql is checked in.
RUN npm run codegen && npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone server.js binds to $HOSTNAME if set — Docker auto-sets
# HOSTNAME to the container ID, which only resolves to the container's own
# IP, not 127.0.0.1/localhost. Force 0.0.0.0 so it's reachable both from
# inside the container (healthchecks) and via the mapped host port.
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
