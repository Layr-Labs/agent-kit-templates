FROM oven/bun:1
USER root
WORKDIR /app

# ── System deps: Chrome, X11, clipboard, fonts ──────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg2 ca-certificates curl \
    fonts-liberation fonts-dejavu-core fonts-noto-core \
    xvfb openbox xdotool xclip imagemagick \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgtk-3-0 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome ────────────────────────────────────────────────────────────
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*

ENV DISPLAY=:99

# ── App dependencies ────────────────────────────────────────────────────────
COPY package.json bun.lock* ./
RUN bun install --no-frozen-lockfile

# ── App source + config ─────────────────────────────────────────────────────
COPY src/ src/
COPY tsconfig.json ./
COPY SOUL.md PROCESS.md constitution.md config.toml ./

# ── Entrypoint: starts Xvfb + Chrome + agent ────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /app/.data
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

ENTRYPOINT ["/entrypoint.sh"]
