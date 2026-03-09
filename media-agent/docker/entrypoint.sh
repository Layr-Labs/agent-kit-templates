#!/bin/bash
set -e

# ── System services ───────────────────────────────────────────────────────
# Fix missing/empty machine-id (Chrome and dbus expect this)
if [ ! -s /etc/machine-id ]; then
    mkdir -p /var/lib/dbus
    if command -v dbus-uuidgen >/dev/null 2>&1; then
        dbus-uuidgen --ensure=/etc/machine-id >/dev/null 2>&1 || true
    fi
    if [ ! -s /etc/machine-id ] && command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]' > /etc/machine-id
    fi
    chmod 0444 /etc/machine-id 2>/dev/null || true
    ln -sf /etc/machine-id /var/lib/dbus/machine-id 2>/dev/null || true
fi

# Start dbus system + session buses so Chrome doesn't spam errors
mkdir -p /run/dbus
dbus-daemon --system --fork --nopidfile 2>/dev/null || true
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/0}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || true
dbus-daemon --session --fork --nopidfile --address="unix:path=${XDG_RUNTIME_DIR}/bus" 2>/dev/null || true
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24+32 -nolisten tcp -ac +extension GLX +render &
sleep 2

openbox --sm-disable &
sleep 1

# ── Transparent SOCKS5 proxy ──────────────────────────────────────────────
# Chrome gets ZERO proxy flags. proxychains-ng intercepts all TCP at the
# libc level via LD_PRELOAD. The browser cannot detect it.
#
# PROXY_URL format: socks5://host:port:user:pass
# Or split env vars: PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS

if [ -n "$PROXY_URL" ] && [ -z "$PROXY_HOST" ]; then
    STRIPPED=$(echo "$PROXY_URL" | sed 's|^[^:]*://||')
    PROXY_HOST=$(echo "$STRIPPED" | cut -d: -f1)
    PROXY_PORT=$(echo "$STRIPPED" | cut -d: -f2)
    PROXY_USER=$(echo "$STRIPPED" | cut -d: -f3)
    PROXY_PASS=$(echo "$STRIPPED" | cut -d: -f4-)
fi

PROXY_ACTIVE=0

if [ -n "$PROXY_HOST" ] && [ -n "$PROXY_PORT" ]; then
    /usr/local/bin/gost \
        -L "socks5://:1080" \
        -F "socks5://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}" \
        > /dev/null 2>&1 &
    sleep 2

    if curl -x socks5://127.0.0.1:1080 -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 10 https://httpbin.org/ip 2>/dev/null | grep -q "200"; then
        echo "proxy: ok (→ ${PROXY_HOST}:${PROXY_PORT})"
        PROXY_ACTIVE=1
    else
        echo "proxy: WARN verification failed, continuing without proxy"
    fi

    cat > /etc/proxychains4.conf <<PCEOF
strict_chain
quiet_mode
proxy_dns
[ProxyList]
socks5 127.0.0.1 1080
PCEOF
fi

# ── Chrome ────────────────────────────────────────────────────────────────
# No proxy flags. No automation-leaking flags. Legit browser.
PROFILE_DIR=/app/.data/chrome-profile
mkdir -p "$PROFILE_DIR"

# Clear stale profile locks from previous container crashes/restarts
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/SingletonCookie" 2>/dev/null || true
rm -rf /tmp/com.google.Chrome.* /tmp/.org.chromium.Chromium.* 2>/dev/null || true
pkill -9 -f "google-chrome-stable|/opt/google/chrome/chrome" 2>/dev/null || true

CHROME_ARGS=(
    --no-sandbox
    --disable-dev-shm-usage
    --disable-gpu
    --no-first-run
    --no-default-browser-check
    --disable-blink-features=AutomationControlled
    --lang=en-US
    --window-size=1920,1080
    --remote-debugging-port=9222
    --user-data-dir=${PROFILE_DIR}
)

if [ "$PROXY_ACTIVE" = "1" ]; then
    CHROME_ARGS+=(--proxy-server="socks5://127.0.0.1:1080")
fi

google-chrome-stable "${CHROME_ARGS[@]}" about:blank &

echo "Waiting for Chrome..."
for i in $(seq 1 30); do
    if curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
        echo "Chrome ready on port 9222"
        break
    fi
    sleep 1
done

if ! curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
    echo "Chrome failed to start (CDP not ready). Exiting."
    exit 1
fi

# ── Live viewer (noVNC) ───────────────────────────────────────────────────
if [ "${ENABLE_VIEWER:-0}" = "1" ]; then
    # Fix noVNC version-mismatch caching issues: some clients may have cached
    # a newer core/rfb.js that expects this export. Provide a safe default.
    if ! grep -q "supportsWebCodecsH264Decode" /opt/novnc/core/util/browser.js 2>/dev/null; then
        printf "\n// Added by container bootstrap for compatibility\nexport const supportsWebCodecsH264Decode = false;\n" >> /opt/novnc/core/util/browser.js
    fi

    # view-only: no mouse/keyboard/clipboard injection from the viewer
    x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -shared -forever -noxdamage -ncache 0 -viewonly -noclipboard &>/dev/null &
    websockify --web /opt/novnc 6080 localhost:5900 &>/dev/null &
    sleep 1
    echo "viewer: http://0.0.0.0:6080/vnc.html"
fi

# ── Agent files from env vars (coordinator injection) ─────────────────────
if [ -n "$SOUL_MD_B64" ]; then
  echo "$SOUL_MD_B64" | base64 -d > /app/SOUL.md
  echo "Injected SOUL.md from env"
fi
if [ -n "$PROCESS_TOML_B64" ]; then
  echo "$PROCESS_TOML_B64" | base64 -d > /app/PROCESS.toml
  echo "Injected PROCESS.toml from env"
fi
if [ -n "$CONSTITUTION_MD_B64" ]; then
  echo "$CONSTITUTION_MD_B64" | base64 -d > /app/constitution.md
  echo "Injected constitution.md from env"
fi

# ── Start the agent ───────────────────────────────────────────────────────
echo "Starting agent..."
echo "Node/Bun version: $(bun --version 2>&1)"
echo "Working dir: $(pwd)"
echo "Files: $(ls -la SOUL.md PROCESS.toml constitution.md 2>&1)"
echo "Main exists: $(ls -la src/main.ts 2>&1)"

# Only Chrome is proxied (via --proxy-server flag above).
# Bun/Node API calls (AI Gateway, EigenMail, etc.) go direct —
# they don't need residential IPs and bun doesn't support SOCKS5 fetch.
exec bun src/main.ts 2>&1
