FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.5.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Tooling contains the migration/bootstrap CLI. Runtime never receives admin credentials.
FROM build AS tooling
CMD ["pnpm", "db:provision"]

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
WORKDIR /app
# Keep the exact generated Prisma peer graph from the validated build.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3100
CMD ["node", "dist/apps/api/src/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/web /usr/share/nginx/html
EXPOSE 8080
