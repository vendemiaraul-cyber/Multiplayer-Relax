# Hugging Face Space (Docker) for the Relax Hub Chromium (Docker Spaces need a paid HF plan).
# The Space only needs this file + README.md: the server code is pulled from GitHub.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    CHROMIUM_NO_SANDBOX=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    HOST=0.0.0.0 \
    PORT=7860

WORKDIR /app
# To pick up newer server code later: Space Settings → "Factory rebuild".
RUN git clone --depth 1 https://github.com/vendemiaraul-cyber/Multiplayer-Relax.git /tmp/src \
 && mkdir -p chromium \
 && cp /tmp/src/chromium/package.json /tmp/src/chromium/core.js /tmp/src/chromium/server.js chromium/ \
 && rm -rf /tmp/src \
 && cd chromium && npm install --omit=dev --no-audit --no-fund

# Spaces run as uid 1000 (the image's "node" user) and route to port 7860.
# Set ACCESS_KEY and ALLOWED_ORIGIN in the Space's variables.
EXPOSE 7860
USER node
CMD ["node", "chromium/server.js"]
