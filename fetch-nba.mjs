// Pulls REAL NBA shot data (public GitHub dataset) by season and writes nba-data.js.
// stats.nba.com blocks datacenter IPs, so we use DomSamangy/NBA_Shots_04_25 (every shot, by season).
// Run:  node fetch-nba.mjs      (Node 18+, no installs — unzips with built-in zlib)
import { writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const SEASONS = [2021, 2022, 2023, 2024, 2025];
const zipUrl = (s) => `https://raw.githubusercontent.com/DomSamangy/NBA_Shots_04_25/main/NBA_${s}_Shots.csv.zip`;
const MAX_SHOTS = 800; // sample cap per player-season (keeps the data file lean; diet stays exact)

const PLAYERS = [
  "Stephen Curry", "Giannis Antetokounmpo", "Shai Gilgeous-Alexander", "Anthony Edwards",
  "Jayson Tatum", "LeBron James", "Nikola Jokić", "Luka Dončić", "Kevin Durant",
  "Devin Booker", "Jalen Brunson", "Donovan Mitchell",
];

const ZONE_AREA = {
  "Restricted Area": "At the rim",
  "In The Paint (Non-RA)": "Close range",
  "Mid-Range": "Mid-range",
  "Left Corner 3": "3-pointers", "Right Corner 3": "3-pointers", "Above the Break 3": "3-pointers",
};
const AREAS = ["At the rim", "Close range", "Mid-range", "3-pointers"];
const HOOP_Y = 5.25;

function splitCsv(line){
  const out=[]; let cur="", q=false;
  for (let i=0;i<line.length;i++){ const c=line[i];
    if (q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else { if(c==='"') q=true; else if(c===',') {out.push(cur);cur="";} else cur+=c; }
  }
  out.push(cur); return out;
}
function unzipSingle(buf){
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip file");
  const method = buf.readUInt16LE(8);
  let compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (compSize === 0) { const cd = buf.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); compSize = buf.readUInt32LE(cd + 20); }
  const comp = buf.subarray(start, start + compSize);
  return method === 0 ? comp : inflateRawSync(comp);
}
function sample(arr, max){
  if (arr.length <= max) return arr;
  const step = arr.length / max, out = [];
  for (let i=0; i<arr.length; i+=step) out.push(arr[Math.floor(i)]);
  return out;
}

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
    const x = +r[col.LOC_X], y = +r[col.LOC_Y] - HOOP_Y;
    if (!isFinite(x) || !isFinite(y) || y < -2 || y > 42) continue;
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
for (const season of SEASONS){
  console.log(`Downloading ${season} NBA shots...`);
  const res = await fetch(zipUrl(season));
  const csv = unzipSingle(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const data = aggregateSeason(csv);
  for (const [name, d] of Object.entries(data)){
    (players[name] ||= { seasons:{} }).seasons[season] = d;
    console.log(`  ✓ ${name} ${season}: ${d.shots.length} shots`);
  }
}

writeFileSync("nba-data.js", "window.SIGHTLINE_NBA = " + JSON.stringify({ players }, null, 0) + ";\n");
console.log(`\nWrote nba-data.js: ${Object.keys(players).length} players, seasons ${SEASONS.join("/")}.`);
