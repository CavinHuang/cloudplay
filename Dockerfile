# Online build image only. For offline deployment use docker save/load from a built image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 CLOUDPLAY_P0_UI_ENABLED=0
RUN addgroup -S cloudplay && adduser -S cloudplay -G cloudplay
COPY --from=build --chown=cloudplay:cloudplay /app/.next/standalone ./
COPY --from=build --chown=cloudplay:cloudplay /app/.next/static ./.next/static
COPY --from=build --chown=cloudplay:cloudplay /app/public ./public
USER cloudplay
EXPOSE 3000
CMD ["node","server.js"]
