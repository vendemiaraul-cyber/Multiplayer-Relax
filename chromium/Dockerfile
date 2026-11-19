# Embedded Chromium for Relax Hub (Render, Hugging Face Spaces, Fly, any Docker host).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app
COPY server/package.json server/package.json
COPY server/ws.js server/ws.js
COPY chromium/package.json chromium/package.json
COPY chromium/server.js chromium/server.js

# Render sets $PORT; Hugging Face Spaces uses 7860 (the default).
EXPOSE 7860
USER node
CMD ["node", "chromium/server.js"]
