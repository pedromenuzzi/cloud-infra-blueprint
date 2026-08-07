#!/usr/bin/env bash
# A deliberately slow task (about 10 seconds). Mission asset: do not edit.
cd "$(dirname "$0")" || exit 1
: > slow.log
i=1
while [ "$i" -le 10 ]; do
  echo "tick $i" >> slow.log
  sleep 1
  i=$((i+1))
done
echo "done" >> slow.log
