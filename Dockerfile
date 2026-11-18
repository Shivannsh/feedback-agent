FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.lock.txt backend/
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r backend/requirements.lock.txt

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build -- --webpack \
    && npm prune --omit=dev

WORKDIR /app
COPY backend/app/ backend/app/
COPY scripts/start-hosted.sh scripts/

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    REQUIRE_APP_PASSWORD=1
EXPOSE 8080
CMD ["bash", "scripts/start-hosted.sh"]
