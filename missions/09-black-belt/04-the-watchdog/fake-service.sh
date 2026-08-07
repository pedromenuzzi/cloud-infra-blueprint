#!/usr/bin/env bash
# A tiny fake service for the watchdog mission. Mission asset: do not edit.
# Usage: ./fake-service.sh start|stop|status
# Safety: the service exits on its own after 5 minutes.
cd "$(dirname "$0")" || exit 1
PIDFILE="service.pid"
case "${1:-}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    (
      n=0
      while [ "$n" -lt 300 ]; do sleep 1; n=$((n+1)); done
    ) &
    echo $! > "$PIDFILE"
    echo "service started (pid $(cat "$PIDFILE"))"
    ;;
  stop)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" 2>/dev/null
      echo "service stopped"
    else
      echo "service is not running"
    fi
    rm -f "$PIDFILE"
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    echo "stopped"
    exit 3
    ;;
  *)
    echo "usage: ./fake-service.sh start|stop|status" >&2
    exit 1
    ;;
esac
