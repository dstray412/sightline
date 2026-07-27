#!/bin/bash
# SIGHTLINE daily data refresh.
# Pulls ONLY the current season (--refresh) and merges it into the existing
# data files, then commits so there's a history of how the numbers evolve.
# Run by the launchd job com.sightline.refresh (or manually: bash refresh.sh).

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$HOME/Desktop/sports-viz" || exit 1

echo "===== refresh started $(date) =====" >> refresh.log
node fetch-mlb.mjs --refresh >> refresh.log 2>&1
node fetch-nba.mjs --refresh >> refresh.log 2>&1

# Commit only if the data actually changed.
if ! git diff --quiet -- mlb-data.js nba-data.js 2>/dev/null; then
  git add mlb-data.js nba-data.js
  git commit -m "data: daily refresh $(date +%F)" >> refresh.log 2>&1
  echo "committed refreshed data" >> refresh.log
else
  echo "no data changes" >> refresh.log
fi
echo "===== refresh finished $(date) =====" >> refresh.log
