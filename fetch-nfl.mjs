// Pulls REAL NFL play-by-play (nflverse) and writes nfl-data.js.
// Run:  node fetch-nfl.mjs   (or --refresh for current season only). Node 18+, no installs.
import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { splitCsv, sample, loadExisting, mergeSeasons, nflOutcome, nflLane, percentileRank } from "./pipeline.mjs";

// Team code -> nickname (for the Team Profile radar). nflverse codes: LA=Rams, LV=Raiders, WAS=Commanders.
const NFL_TEAM_NAMES = {
  ARI:"Cardinals", ATL:"Falcons", BAL:"Ravens", BUF:"Bills", CAR:"Panthers", CHI:"Bears", CIN:"Bengals",
  CLE:"Browns", DAL:"Cowboys", DEN:"Broncos", DET:"Lions", GB:"Packers", HOU:"Texans", IND:"Colts",
  JAX:"Jaguars", KC:"Chiefs", LA:"Rams", LAC:"Chargers", LV:"Raiders", MIA:"Dolphins", MIN:"Vikings",
  NE:"Patriots", NO:"Saints", NYG:"Giants", NYJ:"Jets", PHI:"Eagles", PIT:"Steelers", SF:"49ers",
  SEA:"Seahawks", TB:"Buccaneers", TEN:"Titans", WAS:"Commanders",
};
const RADAR_AXES = ["Passing","Rushing","Pass D","Rush D","Big plays","Takeaways"];

const SEASONS = [2022, 2023, 2024, 2025];
const pbpUrl = s => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${s}.csv.gz`;
const MAX_PASSES = 700;
const REFRESH = process.argv.includes("--refresh");
// NFL season spans Sep–Feb; before September the "current" season is last year.
const CURRENT_SEASON = new Date().getFullYear() - (new Date().getMonth() < 8 ? 1 : 0);

const QBS = ["P.Mahomes","J.Allen","L.Jackson","J.Burrow","J.Goff","C.Stroud","J.Herbert","M.Stafford",
  "J.Hurts","D.Prescott","T.Tagovailoa","T.Lawrence","J.Love","B.Purdy","J.Daniels","C.Williams","B.Nix","K.Murray","G.Smith"];

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

// Team Profile: aggregate every scrimmage play by team (offense + defense) into 6 raw metrics.
function aggregateTeamsRaw(csv){
  const lines = csv.split(/\r?\n/);
  const col = Object.fromEntries(splitCsv(lines[0]).map((c,i)=>[c,i]));
  for (const c of ["season_type","posteam","defteam","pass","rush","epa","yards_gained","interception","fumble_lost"])
    if (col[c]===undefined) throw new Error(`missing column ${c}`);
  const acc = {};
  const get = code => (acc[code] ||= { pE:0,pN:0, rE:0,rN:0, dpE:0,dpN:0, drE:0,drN:0, big:0, off:0, take:0, give:0 });
  for (let i=1;i<lines.length;i++){
    if (!lines[i]) continue;
    const r = splitCsv(lines[i]);
    if (r[col.season_type]!=="REG") continue;
    const isPass = r[col.pass]==="1", isRush = r[col.rush]==="1";
    if (!isPass && !isRush) continue;            // scrimmage plays only
    const epa = +r[col.epa]; if (!isFinite(epa)) continue;
    const yds = +r[col.yards_gained];
    const intc = r[col.interception]==="1", fum = r[col.fumble_lost]==="1";
    const pos = r[col.posteam], def = r[col.defteam];
    if (pos){ const o=get(pos); o.off++;
      if (isPass){ o.pE+=epa; o.pN++; } else { o.rE+=epa; o.rN++; }
      if (isFinite(yds) && yds>=20) o.big++;
      if (intc) o.give++; if (fum) o.give++;
    }
    if (def){ const d=get(def);
      if (isPass){ d.dpE+=epa; d.dpN++; } else { d.drE+=epa; d.drN++; }
      if (intc) d.take++; if (fum) d.take++;
    }
  }
  const vals = {};
  for (const [code,a] of Object.entries(acc)){
    if (a.off < 200) continue; // partial team, skip
    vals[code] = {
      "Passing":   a.pN ? a.pE/a.pN : 0,
      "Rushing":   a.rN ? a.rE/a.rN : 0,
      "Pass D":    a.dpN ? -(a.dpE/a.dpN) : 0,  // fewer expected points allowed = better
      "Rush D":    a.drN ? -(a.drE/a.drN) : 0,
      "Big plays": a.off ? a.big/a.off : 0,
      "Takeaways": a.take - a.give,             // turnover margin
    };
  }
  return vals;
}
// Rate every team 0-100 on each axis vs the rest of the league that season.
function ratingsForSeason(csv){
  const vals = aggregateTeamsRaw(csv), codes = Object.keys(vals), out = {};
  for (const code of codes) out[code] = {};
  for (const m of RADAR_AXES){
    const all = codes.map(c => vals[c][m]);
    for (const code of codes) out[code][m] = percentileRank(vals[code][m], all);
  }
  return out;
}

const qbs = {}, teams = {};
for (const season of (REFRESH ? [CURRENT_SEASON] : SEASONS)){
  try {
    console.log(`Downloading ${season} NFL play-by-play (~19 MB)...`);
    const res = await fetch(pbpUrl(season));
    if (!res.ok){ console.log(`  · ${season}: HTTP ${res.status} — skipped`); continue; }
    const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    const data = aggregateSeason(csv, new Set(QBS));
    for (const [qb,d] of Object.entries(data)){ (qbs[qb] ||= {seasons:{}}).seasons[season]=d; console.log(`  ✓ ${qb} ${season}: ${d.passes.length} passes`); }
    const rt = ratingsForSeason(csv);
    for (const [code,ratings] of Object.entries(rt)){ (teams[code] ||= { name:NFL_TEAM_NAMES[code]||code, seasons:{} }).seasons[season] = { ratings }; }
    console.log(`  ✓ teams ${season}: ${Object.keys(rt).length} rated`);
  } catch(e){ console.log(`  · ${season}: ${e.message}`); }
}

let result = { qbs };
if (REFRESH){
  const ex = loadExisting("nfl-data.js", "SIGHTLINE_NFL");
  if (ex && ex.qbs){ mergeSeasons(ex.qbs, qbs); result = ex; }
}
writeFileSync("nfl-data.js", "window.SIGHTLINE_NFL = " + JSON.stringify(result, null, 0) + ";\n");

let tResult = { teams };
if (REFRESH){
  const ex = loadExisting("nfl-teams-data.js", "SIGHTLINE_NFLTEAMS");
  if (ex && ex.teams){ mergeSeasons(ex.teams, teams); tResult = ex; }
}
writeFileSync("nfl-teams-data.js", "window.SIGHTLINE_NFLTEAMS = " + JSON.stringify(tResult, null, 0) + ";\n");
console.log(`\nWrote nfl-data.js (${Object.keys(result.qbs).length} QBs) + nfl-teams-data.js (${Object.keys(tResult.teams).length} teams)${REFRESH?` — refreshed ${CURRENT_SEASON} only`:``}.`);
