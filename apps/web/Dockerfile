# Build from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:20-slim AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci
COPY apps/web ./
# codegen needs a schema file present but not a live Hasura — schema.graphql is checked in.
RUN npm run codegen && npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
