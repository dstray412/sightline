#!/bin/bash
# SIGHTLINE daily data refresh.
# Pulls ONLY the current season (--refresh) and merges it into the existing
# data files, then commits so there's a history of how the numbers evolve.
# Run by the launchd job com.sightline.refresh (or manually: bash refresh.sh).
#
# Sanity guard: a fetch that returns near-zero entities (API/schema change, and
# loadExisting couldn't recover the old file) would otherwise overwrite history
# with an empty file. We snapshot entity counts before/after; if any file's
# count craters (< half of before, when before was non-trivial), we restore that
# file from git and refuse to commit it, logging an ALERT instead.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$HOME/Desktop/sports-viz" || exit 1

echo "===== refresh started $(date) =====" >> refresh.log

# count entities across the named collections of a window.SIGHTLINE_* data file (0 if unreadable)
count() { node -e "try{const w={};new Function('window',require('fs').readFileSync(process.argv[1],'utf8'))(w);const d=w[process.argv[2]]||{};let n=0;for(const k of process.argv.slice(3))n+=Object.keys(d[k]||{}).length;console.log(n)}catch{console.log(0)}" "$@" 2>/dev/null || echo 0; }

MLB_BEFORE=$(count mlb-data.js SIGHTLINE_MLB pitchers hitters)
NBA_BEFORE=$(count nba-data.js SIGHTLINE_NBA players)
NFL_BEFORE=$(count nfl-data.js SIGHTLINE_NFL qbs)

node fetch-mlb.mjs --refresh >> refresh.log 2>&1
node fetch-nba.mjs --refresh >> refresh.log 2>&1
node fetch-nfl.mjs --refresh >> refresh.log 2>&1

# restore + skip a file whose entity count cratered (guards against wiping history)
guard() { # name file before after
  local before="$3" after="$4"
  if [ "$before" -ge 8 ] && [ "$after" -lt "$(( before / 2 ))" ]; then
    echo "ALERT: $1 entity count cratered ($before -> $after) — restoring $2, NOT committing it" >> refresh.log
    git checkout -- "$2" 2>/dev/null
  fi
}
guard MLB mlb-data.js "$MLB_BEFORE" "$(count mlb-data.js SIGHTLINE_MLB pitchers hitters)"
guard NBA nba-data.js "$NBA_BEFORE" "$(count nba-data.js SIGHTLINE_NBA players)"
guard NFL nfl-data.js "$NFL_BEFORE" "$(count nfl-data.js SIGHTLINE_NFL qbs)"

# Commit only the files that actually changed (cratered ones were restored above).
if ! git diff --quiet -- mlb-data.js nba-data.js nfl-data.js 2>/dev/null; then
  git add mlb-data.js nba-data.js nfl-data.js
  git commit -m "data: daily refresh $(date +%F)" >> refresh.log 2>&1
  echo "committed refreshed data" >> refresh.log
else
  echo "no data changes" >> refresh.log
fi
echo "===== refresh finished $(date) =====" >> refresh.log
