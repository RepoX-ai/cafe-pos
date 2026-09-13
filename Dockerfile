# syntax=docker/dockerfile:1
#
# Single production image that also carries `drizzle-kit`/`tsx` so
# `npm run db:migrate` and `npm run db:seed` work as one-off commands
# against this same image (`docker compose run app npm run db:migrate`),
# without needing a separate toolchain image.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack disable

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Durable uploads are served by /media/menu/[filename]; Compose mounts this directory.
RUN mkdir -p var/uploads/menu && chown -R nextjs:nodejs var/uploads
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "run", "start"]
