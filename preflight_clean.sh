#!/usr/bin/env bash
set -euo pipefail

echo "▶ Stopping any Primordia docker stack (if running)…"
docker compose down --remove-orphans 2>/dev/null || true

echo "▶ Removing standalone Firestore emulator container (if present)…"
docker rm -f primordia-firestore 2>/dev/null || true

echo "▶ Cleaning any PM2 apps named primordia (if present)…"
command -v pm2 >/dev/null && pm2 delete all >/dev/null 2>&1 || true

echo "▶ Showing docker containers matching 'primordia' (should be empty):"
docker ps --filter "name=primordia" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo "▶ Detecting ports declared in docker-compose files (host side):"
# Collect host ports from any docker-compose*.yml in this dir
ports=$(grep -hR "^[[:space:]]*-[[:space:]]*[0-9]\+:" docker-compose*.yml 2>/dev/null | sed -E 's/.*- *([0-9]+):.*/\1/' | sort -u || true)
# Fallback common ports if none were parsed
if [ -z "${ports:-}" ]; then
  ports="8080 8085 8081 8681 4443"
fi
echo "  candidate ports: $ports"

echo "▶ Checking listeners on those ports:"
for p in $ports; do
  if ss -ltnp 2>/dev/null | grep -q ":$p "; then
    echo "  ⚠ port $p is IN USE:"
    ss -ltnp | awk -v p=":$p " '$0 ~ p {print "   ",$0}'
  else
    echo "  ✓ port $p is free"
  fi
done

echo "▶ If any port is in use above and it's a stray process, you can stop it with:"
echo "    kill -TERM <PID>    # gentler"
echo "    kill -9 <PID>       # last resort"
echo "  (PID shows at the end of the ss line as pid=1234.)"

echo "✅ Preflight clean complete."
