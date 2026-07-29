// Pulls REAL NBA shot data (public GitHub dataset) by season and writes nba-data.js.
// stats.nba.com blocks datacenter IPs, so we use DomSamangy/NBA_Shots_04_25 (every shot, by season).
// Run:  node fetch-nba.mjs      (Node 18+, no installs — unzips with built-in zlib)
import { writeFileSync } from "node:fs";
import { splitCsv, sample, loadExisting, mergeSeasons, unzipSingle, nbaShotCoord, NBA_ZONE_AREA as ZONE_AREA, HOOP_Y } from "./pipeline.mjs";

// `--refresh` = pull ONLY the current season and merge into existing data (fast daily update).
const REFRESH = process.argv.includes("--refresh");
const CURRENT_SEASON = new Date().getFullYear();

const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]; // 2026 skipped automatically until the dataset adds it
const zipUrl = (s) => `https://raw.githubusercontent.com/DomSamangy/NBA_Shots_04_25/main/NBA_${s}_Shots.csv.zip`;
const MAX_SHOTS = 800; // sample cap per player-season (keeps the data file lean; diet stays exact)

const PLAYERS = [
  "Stephen Curry", "Giannis Antetokounmpo", "Shai Gilgeous-Alexander", "Anthony Edwards",
  "Jayson Tatum", "LeBron James", "Nikola Jokić", "Luka Dončić", "Kevin Durant",
  "Devin Booker", "Jalen Brunson", "Donovan Mitchell",
  "Joel Embiid", "Ja Morant", "Damian Lillard", "Kawhi Leonard", "Jimmy Butler",
  "Trae Young", "De'Aaron Fox", "Paolo Banchero", "Victor Wembanyama",
  "Tyrese Haliburton", "Jaylen Brown", "Kyrie Irving",
];

// ZONE_AREA (as NBA_ZONE_AREA), HOOP_Y, splitCsv, sample, loadExisting, mergeSeasons, nbaShotCoord: from ./pipeline.mjs
const AREAS = ["At the rim", "Close range", "Mid-range", "3-pointers"];


const want = new Set(PLAYERS);

function aggregateSeason(csv){
  const lines = csv.split(/\r?\n/);
  const col = Object.fromEntries(splitCsv(lines[0]).map((c,i)=>[c,i]));
  for (const c of ["PLAYER_NAME","LOC_X","LOC_Y","SHOT_MADE","SHOT_TYPE","BASIC_ZONE"])
    if (col[c]===undefined) throw new Error(`missing column ${c}`);
  const acc = {};
  for (let i=1;i<lines.length;i++){
    if (!lines[i]) continue;
    const r = splitCsv(lines[i]);
    const name = r[col.PLAYER_NAME]; if (!want.has(name)) continue;
    const zone = r[col.BASIC_ZONE]; if (zone === "Backcourt" || !ZONE_AREA[zone]) continue;
    const c = nbaShotCoord(r[col.LOC_X], r[col.LOC_Y]); if (!c) continue;
    const x = c.x, y = c.y;
    const pv = (r[col.SHOT_TYPE]||"").startsWith("3") ? 3 : 2;
    const made = r[col.SHOT_MADE] === "TRUE" ? 1 : 0;
    (acc[name] ||= { zones:{}, raw:[] });
    const a = acc[name];
    (a.zones[zone] ||= { n:0, m:0, pv }); a.zones[zone].n++; a.zones[zone].m += made;
    a.raw.push({ x:+x.toFixed(1), y:+y.toFixed(1), zone });
  }
  const out = {};
  for (const [name,a] of Object.entries(acc)){
    if (a.raw.length < 120) continue; // skip injury/partial seasons
    const zpps={}, zfg={};
    for (const [z,g] of Object.entries(a.zones)){ zpps[z]=g.m*g.pv/g.n; zfg[z]=g.m/g.n; }
    const shots = sample(a.raw, MAX_SHOTS).map(s=>[s.x, s.y, +zpps[s.zone].toFixed(2), +zfg[s.zone].toFixed(2)]);
    const area = Object.fromEntries(AREAS.map(A=>[A,{n:0,m:0,pts:0}]));
    for (const [z,g] of Object.entries(a.zones)){ const A=ZONE_AREA[z]; area[A].n+=g.n; area[A].m+=g.m; area[A].pts+=g.m*g.pv; }
    const total = a.raw.length;
    const diet = AREAS.map(A=>{ const g=area[A]; return {
      label:A, freq:+(g.n/total).toFixed(3), value:g.n?+(g.pts/g.n).toFixed(2):0, shootPct:g.n?Math.round(g.m/g.n*100):0 }; });
    out[name] = { shots, diet };
  }
  return out;
}

const players = {};
for (const season of (REFRESH ? [CURRENT_SEASON] : SEASONS)){
  try {
    console.log(`Downloading ${season} NBA shots...`);
    const res = await fetch(zipUrl(season));
    if (!res.ok){ console.log(`  · ${season}: not published yet (HTTP ${res.status}) — skipped`); continue; }
    const csv = unzipSingle(Buffer.from(await res.arrayBuffer())).toString("utf8");
    const data = aggregateSeason(csv);
    for (const [name, d] of Object.entries(data)){
      (players[name] ||= { seasons:{} }).seasons[season] = d;
      console.log(`  ✓ ${name} ${season}: ${d.shots.length} shots`);
    }
  } catch(e){ console.log(`  · ${season}: skipped (${e.message})`); }
}

let result = { players };
if (REFRESH) {
  const ex = loadExisting("nba-data.js", "SIGHTLINE_NBA");
  if (ex && ex.players) { mergeSeasons(ex.players, players); result = ex; }
}
writeFileSync("nba-data.js", "window.SIGHTLINE_NBA = " + JSON.stringify(result, null, 0) + ";\n");
console.log(`\nWrote nba-data.js${REFRESH?` (refreshed ${CURRENT_SEASON} only)`:``}: ${Object.keys(result.players).length} players.`);
