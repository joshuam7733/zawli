# Production-style image. Migrations run at container start (`prisma migrate deploy`).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S zawli && adduser -S zawli -G zawli
COPY --from=build /app ./
# Uploaded menu photos and logos live here (mount a volume on it in production).
RUN mkdir -p /app/storage/uploads && chown -R zawli:zawli /app/storage
USER zawli
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
