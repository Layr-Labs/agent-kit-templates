FROM oven/bun:1
USER root
WORKDIR /app
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive

# ── System deps: X11, dbus, clipboard, fonts ──────────────────────────────
RUN set -euo pipefail; \
    log_file="$(mktemp)"; \
    if ! { \
      apt-get -qq update && \
      audio_pkg="$(if apt-cache show libasound2 >/dev/null 2>&1; then echo libasound2; else echo libasound2t64; fi)" && \
      apt-get -yqq install --no-install-recommends \
        wget gnupg2 ca-certificates curl \
        uuid-runtime \
        fonts-unifont fonts-liberation fonts-dejavu-core fonts-freefont-ttf \
        fonts-noto-core fonts-noto-color-emoji \
        xvfb openbox dbus dbus-x11 xdg-utils x11-utils \
        libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
        libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
        libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
        libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 "${audio_pkg}" \
        libpango-1.0-0 libpangocairo-1.0-0 libgtk-3-0 libudev1 libvulkan1 \
        libxkbcommon0 libgl1-mesa-dri libglx-mesa0 libegl-mesa0 \
        locales xdotool xclip imagemagick \
        x11vnc websockify \
        proxychains-ng \
        python3-pip && \
      rm -rf /var/lib/apt/lists/* && \
      mkdir -p /opt/novnc; \
    } >"$log_file" 2>&1; then \
      cat "$log_file"; \
      rm -f "$log_file"; \
      exit 1; \
    fi; \
    rm -f "$log_file"; \
    echo "system deps: ok"

# ── noVNC (pin known-good upstream bundle) ─────────────────────────────────
ARG NOVNC_VERSION=1.5.0
RUN rm -rf /opt/novnc/* && \
    curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" \
      | tar -xz -C /opt && \
    mv "/opt/noVNC-${NOVNC_VERSION}"/* /opt/novnc/ && \
    rm -rf "/opt/noVNC-${NOVNC_VERSION}"

# ── gost (proxy forwarder: local no-auth → remote with auth) ──────────────
RUN curl -fsSL https://github.com/ginuerzh/gost/releases/download/v2.12.0/gost_2.12.0_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin/ gost

# ── Locale + timezone ────────────────────────────────────────────────────
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8
ENV TZ=America/Los_Angeles
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ── Google Chrome (official package payload, extracted directly) ──────────
RUN set -euo pipefail; \
    log_file="$(mktemp)"; \
    if ! { \
      wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
      dpkg-deb -x /tmp/chrome.deb / && \
      rm /tmp/chrome.deb; \
    } >"$log_file" 2>&1; then \
      cat "$log_file"; \
      rm -f "$log_file"; \
      exit 1; \
    fi; \
    rm -f "$log_file"; \
    echo "chrome: ok"

ENV DISPLAY=:99
ENV CHROME_PATH=/usr/bin/google-chrome-stable

# ── App dependencies ─────────────────────────────────────────────────────
COPY package.json bun.lock* ./
RUN bun install --no-frozen-lockfile

# ── App source + config ──────────────────────────────────────────────────
COPY site/ site/
COPY src/ src/
COPY skills-catalog/ skills-catalog/
COPY tsconfig.json ./
COPY SOUL.md PROCESS.toml constitution.md config.toml ./
COPY docker/entrypoint.sh /entrypoint.sh
RUN bun run site:build
RUN chmod +x /entrypoint.sh

VOLUME /app/.data
EXPOSE 3000 6080

ENV NODE_ENV=production
ENV PORT=3000

CMD ["/entrypoint.sh"]
