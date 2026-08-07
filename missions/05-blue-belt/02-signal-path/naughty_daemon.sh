#!/usr/bin/env bash
# The Naughty Daemon — it ignores polite requests to stop.
# (Mission asset: do not edit. Safety: it gives up on its own after 10 minutes.)
cd "$(dirname "$0")" || exit 1
echo "daemon started pid=$$" >> daemon.log
echo $$ > daemon.pid
trap 'echo "SIGTERM received — ignoring (I am naughty)" >> daemon.log' TERM
trap 'echo "SIGINT received — ignoring (try harder)" >> daemon.log' INT
n=0
while [ "$n" -lt 600 ]; do
  sleep 1
  n=$((n+1))
done
echo "daemon got bored and left on its own" >> daemon.log
