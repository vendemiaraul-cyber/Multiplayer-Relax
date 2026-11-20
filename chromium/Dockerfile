# Relax Hub Chromium in a container (Render, Fly, Koyeb, any Docker host).
# Uses the system Chromium; puppeteer doesn't download its own.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    CHROMIUM_NO_SANDBOX=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    HOST=0.0.0.0 \
    PORT=7860

WORKDIR /app
COPY chromium/package.json chromium/package.json
RUN cd chromium && npm install --omit=dev --no-audit --no-fund
COPY chromium/core.js chromium/server.js chromium/

# Set ACCESS_KEY (and ALLOWED_ORIGIN=https://your-game) in the host's settings;
# without ACCESS_KEY a random key is printed in the logs at start.
EXPOSE 7860
USER node
CMD ["node", "chromium/server.js"]
