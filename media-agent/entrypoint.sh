#!/bin/bash
set -e

# ── Xvfb (virtual display) ──────────────────────────────────────────────────
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac &
sleep 2

# ── Window manager (Chrome needs one) ───────────────────────────────────────
openbox --sm-disable &
sleep 1

# ── Chrome with persistent profile ──────────────────────────────────────────
mkdir -p /app/.data/chrome-profile

google-chrome-stable \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --no-first-run \
    --no-default-browser-check \
    --disable-blink-features=AutomationControlled \
    --window-size=1920,1080 \
    --remote-debugging-port=9222 \
    --user-data-dir=/app/.data/chrome-profile \
    about:blank &

# Wait for Chrome CDP to be ready
echo "Waiting for Chrome..."
for i in $(seq 1 30); do
    if curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
        echo "Chrome ready on port 9222"
        break
    fi
    sleep 1
done

# ── Start the agent ─────────────────────────────────────────────────────────
exec bun src/main.ts
