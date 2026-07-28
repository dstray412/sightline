// Pulls REAL NFL play-by-play (nflverse) and writes nfl-data.js.
// Run:  node fetch-nfl.mjs   (or --refresh for current season only). Node 18+, no installs.
import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { splitCsv, sample, loadExisting, mergeSeasons, nflOutcome, nflLane } from "./pipeline.mjs";

const SEASONS = [2022, 2023, 2024, 2025];
const pbpUrl = s => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${s}.csv.gz`;
const MAX_PASSES = 700;
const REFRESH = process.argv.includes("--refresh");
// NFL season spans Sep–Feb; before September the "current" season is last year.
const CURRENT_SEASON = new Date().getFullYear() - (new Date().getMonth() < 8 ? 1 : 0);

const QBS = ["P.Mahomes","J.Allen","L.Jackson","J.Burrow","J.Goff","C.Stroud","J.Herbert","M.Stafford"];

// Air-yards depth buckets for the "Air Yards" view.
const BUCKETS = [
  { label:"Behind LOS", lo:-99, hi:0 }, { label:"0–5", lo:0, hi:5 }, { label:"5–10", lo:5, hi:10 },
  { label:"10–15", lo:10, hi:15 }, { label:"15–20", lo:15, hi:20 }, { label:"20+", lo:20, hi:999 },
];

// splitCsv / sample / loadExisting / mergeSeasons / nflOutcome / nflLane are imported from ./pipeline.mjs

function aggregateSeason(csv, want){
  const lines = csv.split(/\r?\n/);
  const col = Object.fromEntries(splitCsv(lines[0]).map((c,i)=>[c,i]));
  for (const c of ["play_type","passer_player_name","air_yards","pass_location","complete_pass","pass_touchdown","interception","season_type"])
    if (col[c]===undefined) throw new Error(`missing column ${c}`);
  const acc = {};
  for (let i=1;i<lines.length;i++){
    if (!lines[i]) continue;
    const r = splitCsv(lines[i]);
    if (r[col.play_type]!=="pass" || r[col.season_type]!=="REG") continue;
    const qb = r[col.passer_player_name]; if (!want.has(qb)) continue;
    const loc = r[col.pass_location]; if (loc!=="left" && loc!=="middle" && loc!=="right") continue;
    const ay = +r[col.air_yards]; if (!isFinite(ay)) continue;
    const td = r[col.pass_touchdown]==="1", intc = r[col.interception]==="1", comp = r[col.complete_pass]==="1";
    const out = nflOutcome(td, intc, comp);
    const lane = nflLane(loc);
    (acc[qb] ||= { passes:[], buckets:BUCKETS.map(b=>({...b, att:0, comp:0})) });
    const a=acc[qb];
    a.passes.push([lane, Math.round(ay), out]);
    const b = a.buckets.find(x=>ay>=x.lo && ay<x.hi);
    if (b){ b.att++; if (comp||td) b.comp++; }
  }
  const res={};
  for (const [qb,a] of Object.entries(acc)){
    if (a.passes.length < 80) continue;
    const total = a.passes.length;
    const depth = a.buckets.map(b=>({ label:b.label, freq:+(b.att/total).toFixed(3), compPct:b.att?Math.round(b.comp/b.att*100):0 }));
    res[qb] = { passes:sample(a.passes, MAX_PASSES), depth };
  }
  return res;
}

const qbs = {};
for (const season of (REFRESH ? [CURRENT_SEASON] : SEASONS)){
  try {
    console.log(`Downloading ${season} NFL play-by-play (~19 MB)...`);
    const res = await fetch(pbpUrl(season));
    if (!res.ok){ console.log(`  · ${season}: HTTP ${res.status} — skipped`); continue; }
    const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    const data = aggregateSeason(csv, new Set(QBS));
    for (const [qb,d] of Object.entries(data)){ (qbs[qb] ||= {seasons:{}}).seasons[season]=d; console.log(`  ✓ ${qb} ${season}: ${d.passes.length} passes`); }
  } catch(e){ console.log(`  · ${season}: ${e.message}`); }
}

let result = { qbs };
if (REFRESH){
  const ex = loadExisting("nfl-data.js", "SIGHTLINE_NFL");
  if (ex && ex.qbs){ mergeSeasons(ex.qbs, qbs); result = ex; }
}
writeFileSync("nfl-data.js", "window.SIGHTLINE_NFL = " + JSON.stringify(result, null, 0) + ";\n");
console.log(`\nWrote nfl-data.js${REFRESH?` (refreshed ${CURRENT_SEASON} only)`:``}: ${Object.keys(result.qbs).length} QBs.`);
