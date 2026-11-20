# Hugging Face Space (Docker) for the Relax Hub embedded Chromium.
# The Space only needs this file + README.md: the server code is pulled from GitHub.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=7860

WORKDIR /app
# To pick up newer server code later: Space Settings → "Factory rebuild".
RUN git clone --depth 1 https://github.com/vendemiaraul-cyber/Multiplayer-Relax.git /tmp/src \
 && mkdir -p server chromium \
 && cp /tmp/src/server/ws.js /tmp/src/server/package.json server/ \
 && cp /tmp/src/chromium/server.js /tmp/src/chromium/package.json chromium/ \
 && rm -rf /tmp/src

# Spaces run as uid 1000 (the image's "node" user) and route to port 7860.
EXPOSE 7860
USER node
CMD ["node", "chromium/server.js"]
