# Plant Shutdown Command Center: one container serves the API and the built web app.
# Build context is the repository root (Cloud Build / Cloud Run), app sources live in app/.
FROM node:24-slim AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
COPY app/packages/shutdown-parser/package.json packages/shutdown-parser/
COPY app/apps/api/package.json apps/api/
COPY app/apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY app/packages packages
COPY app/apps apps
RUN npm run build -w @shutdown/web

FROM node:24-slim
# Cloud Run injects PORT (8080) at runtime and overrides this default.
ENV NODE_ENV=production DB_PATH=/data/shutdown.db PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/server.ts"]
