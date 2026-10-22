FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev
COPY server/ ./server/
COPY api/ ./api/
COPY --from=web /app/web/dist ./web/dist
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/index.js"]
