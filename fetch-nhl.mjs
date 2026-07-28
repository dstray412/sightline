// Pulls REAL NHL shot data (MoneyPuck per-season shot files) and writes nhl-data.js.
// Run:  node fetch-nhl.mjs   (or --refresh for the current season only). Node 18+, no installs.
// Produces: nhl-data.js -> window.SIGHTLINE_NHL = { skaters: { name: { seasons: { 2024: {shots:[...]} } } } }
// Each shot = [xCordAdjusted, yCordAdjusted, xGoal, isGoal] on a 200x85 rink (goal at x=89).
import { writeFileSync } from "node:fs";
import { splitCsv, sample, loadExisting, mergeSeasons, unzipSingle, isGoal } from "./pipeline.mjs";

const REFRESH = process.argv.includes("--refresh");
// MoneyPuck seasons are keyed by the START year (2024 = 2024-25). NHL season spans Oct-Jun,
// so before October the "current" season is last year's start.
const CURRENT_SEASON = new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0);
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const zipUrl = s => `https://moneypuck.com/moneypuck/playerData/shots/shots_${s}.zip`;
const MAX_SHOTS = 800; // sample cap per skater-season (keeps the data file lean)

const SKATERS = [
  "Connor McDavid", "Auston Matthews", "Nathan MacKinnon", "Leon Draisaitl", "David Pastrnak",
  "Nikita Kucherov", "Cale Makar", "Sidney Crosby", "Mikko Rantanen", "Matthew Tkachuk",
  "Artemi Panarin", "Jack Hughes",
];

function aggregateSeason(csv, want){
  const lines = csv.split(/\r?\n/);
  const col = Object.fromEntries(splitCsv(lines[0]).map((c,i)=>[c,i]));
  for (const c of ["shooterName","event","xCordAdjusted","yCordAdjusted","xGoal","isPlayoffGame"])
    if (col[c]===undefined) throw new Error(`missing column ${c}`);
  const acc = {};
  for (let i=1;i<lines.length;i++){
    if (!lines[i]) continue;
    const r = splitCsv(lines[i]);
    if (r[col.isPlayoffGame] !== "0") continue;            // regular season only
    const name = r[col.shooterName]; if (!want.has(name)) continue;
    const x = +r[col.xCordAdjusted], y = +r[col.yCordAdjusted], xg = +r[col.xGoal];
    if (!isFinite(x) || !isFinite(y) || !isFinite(xg)) continue;
    (acc[name] ||= []).push([Math.round(x), Math.round(y), +xg.toFixed(3), isGoal(r[col.event]) ? 1 : 0]);
  }
  const out = {};
  for (const [name, shots] of Object.entries(acc)){
    if (shots.length < 50) continue; // skip tiny/partial seasons
    out[name] = { shots: sample(shots, MAX_SHOTS) };
  }
  return out;
}

const skaters = {};
for (const season of (REFRESH ? [CURRENT_SEASON] : SEASONS)){
  try {
    console.log(`Downloading ${season} NHL shots (~20 MB)...`);
    const res = await fetch(zipUrl(season), { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok){ console.log(`  · ${season}: HTTP ${res.status} — skipped`); continue; }
    const csv = unzipSingle(Buffer.from(await res.arrayBuffer())).toString("utf8");
    const data = aggregateSeason(csv, new Set(SKATERS));
    for (const [name, d] of Object.entries(data)){
      (skaters[name] ||= { seasons:{} }).seasons[season] = d;
      console.log(`  ✓ ${name} ${season}: ${d.shots.length} shots`);
    }
  } catch(e){ console.log(`  · ${season}: skipped (${e.message})`); }
}

let result = { skaters };
if (REFRESH){
  const ex = loadExisting("nhl-data.js", "SIGHTLINE_NHL");
  if (ex && ex.skaters){ mergeSeasons(ex.skaters, skaters); result = ex; }
}
writeFileSync("nhl-data.js", "window.SIGHTLINE_NHL = " + JSON.stringify(result, null, 0) + ";\n");
console.log(`\nWrote nhl-data.js${REFRESH?` (refreshed ${CURRENT_SEASON} only)`:``}: ${Object.keys(result.skaters).length} skaters.`);
