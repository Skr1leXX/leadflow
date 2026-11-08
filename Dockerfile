# LeadFlow container image. NOT TESTED: Docker was not available where this was written, so build it once before relying on it.
# Node 22.13+ is required (built-in node:sqlite); the image uses Node 24.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build needs no secrets: everything environment-specific is read at request time.
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LEADFLOW_DB_PATH=/data/leadflow.db
# Dev dependencies stay: next.config.ts is TypeScript and Next loads it at start-up.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.ts ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
# The SQLite database lives here; mount a volume or the data is lost with the container.
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
