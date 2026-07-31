#!/usr/bin/env bash
# Keeps the bot answering. pm2 restarts it when it crashes, but a process can
# stay alive while its HTTP surface is wedged, which pm2 cannot see. This
# checks the thing that actually matters and restarts on two consecutive
# failures, so a single slow response is not treated as an outage.
set -u
LOG=/home/ubuntu2/peterpan/data/watchdog.log
STATE=/tmp/peterpan-watchdog-fails
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

fails=$(cat "$STATE" 2>/dev/null || echo 0)

if curl -fsS -m 10 http://127.0.0.1:3000/health | grep -q '"ok":true'; then
  [ "$fails" != "0" ] && echo "$(date -Is) recovered after $fails failure(s)" >> "$LOG"
  echo 0 > "$STATE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE"
echo "$(date -Is) health check failed ($fails)" >> "$LOG"

if [ "$fails" -ge 2 ]; then
  echo "$(date -Is) restarting peterpan" >> "$LOG"
  pm2 restart peterpan --update-env >> "$LOG" 2>&1
  echo 0 > "$STATE"
fi
