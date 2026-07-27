// Pulls REAL MLB Statcast data and writes mlb-data.js for the SIGHTLINE prototype.
// Run:  node fetch-mlb.mjs      (Node 18+, uses built-in fetch — no installs)
// Produces: mlb-data.js  ->  window.SIGHTLINE_MLB = { pitchers: {...} }
import { writeFileSync, readFileSync } from "node:fs";

// `--refresh` = pull ONLY the current season and merge into existing data (fast daily update).
const REFRESH = process.argv.includes("--refresh");
const CURRENT_SEASON = new Date().getFullYear();
function loadExisting(path){
  try { const w={}; new Function("window", readFileSync(path,"utf8"))(w); return w.SIGHTLINE_MLB; }
  catch { return null; }
}

// Seasons to pull for each pitcher (kept only if the pitcher actually threw that year).
const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];

// Real pitchers. id = MLB player id.
const PITCHERS = [
  { name: "Paul Skenes",   id: 694973 },
  { name: "Tarik Skubal",  id: 669373 },
  { name: "Zack Wheeler",  id: 554430 },
  { name: "Chris Sale",    id: 519242 },
  { name: "Gerrit Cole",   id: 543037 },
  { name: "Corbin Burnes", id: 669203 },
  { name: "Logan Webb",    id: 657277 },
  { name: "Blake Snell",   id: 605483 },
];

// Hitters for the Spray Chart (per season; split by pitcher handedness).
const HITTER_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];
const MAX_BALLS = 400; // sample cap per hitter-season (keeps the data file lean)
const HITTERS = [
  { name: "Aaron Judge",     id: 592450 },
  { name: "Shohei Ohtani",   id: 660271 },
  { name: "Juan Soto",       id: 665742 },
  { name: "Bobby Witt Jr.",  id: 677951 },
  { name: "Freddie Freeman", id: 518692 },
  { name: "Mookie Betts",    id: 605141 },
  { name: "José Ramírez",    id: 608070 },
  { name: "Bryce Harper",    id: 547180 },
];

// pitch_type code -> display name + color (matches the viz palette)
const PITCH = {
  FF:["4-Seam","#ff5470"], FA:["4-Seam","#ff5470"],
  SI:["Sinker","#ffb02e"], FT:["Sinker","#ffb02e"],
  FC:["Cutter","#ff7ae0"],
  SL:["Slider","#38e1ff"], ST:["Sweeper","#22d3ff"], SV:["Slurve","#6ad0ff"],
  CU:["Curveball","#7c5cff"], KC:["Curveball","#7c5cff"], CS:["Curveball","#7c5cff"],
  CH:["Changeup","#42d98a"], FS:["Splitter","#9ae66e"], FO:["Splitter","#9ae66e"],
};

// minimal CSV line splitter (handles quoted fields)
function splitCsv(line){
  const out=[]; let cur="", q=false;
  for (let i=0;i<line.length;i++){ const c=line[i];
    if (q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else { if(c==='"') q=true; else if(c===',') {out.push(cur);cur="";} else cur+=c; }
  }
  out.push(cur); return out;
}
function sample(arr, max){
  if (arr.length <= max) return arr;
  const step = arr.length / max, out = [];
  for (let i=0; i<arr.length; i+=step) out.push(arr[Math.floor(i)]);
  return out;
}

async function fetchPitcher(p, season){
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details`
    + `&hfSea=${season}%7C&hfGT=R%7C&player_type=pitcher&pitchers_lookup%5B%5D=${p.id}`;
  const res = await fetch(url);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(l=>l.length);
  const header = splitCsv(lines[0]);
  const col = Object.fromEntries(header.map((h,i)=>[h,i]));
  const need = ["pitch_type","release_speed","pfx_x","pfx_z","description"];
  for (const c of need) if (col[c]===undefined) throw new Error(`missing column ${c} for ${p.name}`);

  const groups = {}; let total=0;
  for (let i=1;i<lines.length;i++){
    const r = splitCsv(lines[i]);
    const pt = r[col.pitch_type];
    if (!pt || !PITCH[pt]) continue;
    const velo=+r[col.release_speed], hx=+r[col.pfx_x], vz=+r[col.pfx_z];
    if (!isFinite(velo)||!isFinite(hx)||!isFinite(vz)) continue;
    const d = r[col.description];
    const swing = /swinging_strike|foul|hit_into_play|foul_tip/.test(d);
    const whiff = /swinging_strike/.test(d);
    (groups[pt] ||= { velo:[], hx:[], vz:[], n:0, swings:0, whiffs:0 });
    const g=groups[pt];
    g.velo.push(velo); g.hx.push(hx); g.vz.push(vz); g.n++;
    if (swing) g.swings++; if (whiff) g.whiffs++;
    total++;
  }
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const pitches = Object.entries(groups)
    .filter(([,g])=>g.n >= Math.max(30, total*0.02)) // drop rare/mislabeled
    .map(([code,g])=>({
      t: PITCH[code][0],
      hb: +( -avg(g.hx) * 12 ).toFixed(1),   // feet->inches; sign flip => arm-side positive
      vb: +( avg(g.vz) * 12 ).toFixed(1),     // induced vertical (ride positive)
      velo: Math.round(avg(g.velo)),
      use: +(g.n/total).toFixed(3),
      whiff: +(g.swings ? g.whiffs/g.swings : 0).toFixed(3),
    }))
    .sort((a,b)=>b.use-a.use);
  // merge same display-name (e.g., KC+CU both Curveball) — keep by usage
  const merged={};
  for (const pc of pitches){ if(!merged[pc.t]) merged[pc.t]=pc; else if(pc.use>merged[pc.t].use) merged[pc.t]=pc; }
  return { name:p.name, total, pitches:Object.values(merged) };
}

// events -> our 4 outcome buckets (null = not a batted ball we chart)
function outcomeOf(ev){
  if (ev==='single') return 'Single';
  if (ev==='double' || ev==='triple') return 'Double';
  if (ev==='home_run') return 'Home run';
  if (/out|play|choice|error|sac/.test(ev)) return 'Out';
  return null;
}
async function fetchHitter(h, season){
  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details`
    + `&hfSea=${season}%7C&hfGT=R%7C&player_type=batter&batters_lookup%5B%5D=${h.id}`;
  const res = await fetch(url);
  const lines = (await res.text()).split(/\r?\n/).filter(l=>l.length);
  const col = Object.fromEntries(splitCsv(lines[0]).map((c,i)=>[c,i]));
  for (const c of ["hc_x","hc_y","events","p_throws"]) if (col[c]===undefined) throw new Error(`missing ${c}`);
  const hd = col["hit_distance_sc"];
  const balls = [];
  for (let i=1;i<lines.length;i++){
    const r = splitCsv(lines[i]);
    const type = outcomeOf(r[col.events]); if (!type) continue;
    const hx=+r[col.hc_x], hy=+r[col.hc_y]; if (!isFinite(hx)||!isFinite(hy)) continue;
    let a = Math.atan2(hx-125.42, 198.27-hy) * 180/Math.PI;      // 0=center, neg=left field, pos=right
    if (!isFinite(a) || Math.abs(a)>48) continue;                 // drop fouls
    a = Math.max(-47, Math.min(47, a));
    let dist = hd!==undefined ? +r[hd] : NaN;
    if (!isFinite(dist) || dist<=0) dist = Math.min(250, Math.sqrt((hx-125.42)**2 + (hy-198.27)**2) * 2.2);
    balls.push({ a:Math.round(a), dist:Math.min(445,Math.round(dist)), type, hand:(r[col.p_throws]||'R') });
  }
  return balls;
}

const out = {};
const hitters = {};
for (const p of PITCHERS){
  const seasons = {};
  for (const yr of (REFRESH ? [CURRENT_SEASON] : SEASONS)){
    try {
      const r = await fetchPitcher(p, yr);
      if (r.total >= 150){ seasons[yr] = r.pitches; console.log(`✓ ${p.name} ${yr}: ${r.total} pitches`); }
      else console.log(`· ${p.name} ${yr}: ${r.total} pitches (skipped — too few)`);
    } catch(e){ console.error(`✗ ${p.name} ${yr}:`, e.message); }
  }
  if (Object.keys(seasons).length) out[p.name] = { seasons };
}

for (const h of HITTERS){
  const seasons = {};
  for (const yr of (REFRESH ? [CURRENT_SEASON] : HITTER_SEASONS)){
    try {
      const raw = await fetchHitter(h, yr);
      if (raw.length >= 40){
        const balls = sample(raw, MAX_BALLS);
        seasons[yr] = balls;
        const L = balls.filter(b=>b.hand==='L').length, hr = balls.filter(b=>b.type==='Home run').length;
        console.log(`✓ ${h.name} ${yr}: ${balls.length} balls (${balls.length-L} vRHP/${L} vLHP), ${hr} HR`);
      } else console.log(`· ${h.name} ${yr}: ${raw.length} balls (skipped)`);
    } catch(e){ console.error(`✗ ${h.name} ${yr}:`, e.message); }
  }
  if (Object.keys(seasons).length) hitters[h.name] = { seasons };
}

let result = { pitchers: out, hitters };
if (REFRESH) {
  const ex = loadExisting("mlb-data.js");
  if (ex && ex.pitchers && ex.hitters) {
    for (const [n,d] of Object.entries(out))     { (ex.pitchers[n] ||= {seasons:{}}); Object.assign(ex.pitchers[n].seasons, d.seasons); }
    for (const [n,d] of Object.entries(hitters)) { (ex.hitters[n]  ||= {seasons:{}}); Object.assign(ex.hitters[n].seasons,  d.seasons); }
    result = ex;
  }
}
writeFileSync("mlb-data.js", "window.SIGHTLINE_MLB = " + JSON.stringify(result, null, 0) + ";\n");
console.log(`\nWrote mlb-data.js${REFRESH?` (refreshed ${CURRENT_SEASON} only)`:``}: ${Object.keys(result.pitchers).length} pitchers, ${Object.keys(result.hitters).length} hitters.`);
