#!/usr/bin/env bash
# scripts/check-modules.sh
set -euo pipefail
bad=$(grep -rnE "(import .*\.css|style=|<style)" cards/ || true)
if [ -n "$bad" ]; then
  echo "cards/ must not carry styling; the kit owns all of it:"
  echo "$bad"
  exit 1
fi
echo "cards/ clean"
