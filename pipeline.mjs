// Shared, side-effect-free pipeline logic for the SIGHTLINE fetch scripts.
// Everything here is pure (no network, no fs writes) so it can be unit-tested
// directly — see pipeline.test.mjs. The fetch-*.mjs scripts import from here so
// the CSV parser, sampler, merge, and the coordinate transforms live in ONE place.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// --- CSV: minimal splitter that handles quoted fields + escaped quotes ("") ---
export function splitCsv(line){
  const out=[]; let cur="", q=false;
  for (let i=0;i<line.length;i++){ const c=line[i];
    if (q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else { if(c==='"') q=true; else if(c===',') {out.push(cur);cur="";} else cur+=c; }
  }
  out.push(cur); return out;
}

// --- deterministic downsample to at most `max` items, preserving order ---
export function sample(arr, max){
  if (arr.length <= max) return arr;
  const step = arr.length / max, out = [];
  for (let i=0; i<arr.length; i+=step) out.push(arr[Math.floor(i)]);
  return out;
}

// --- load a previously-written window.SIGHTLINE_* data file (for --refresh merge) ---
export function loadExisting(path, key){
  try { const w={}; new Function("window", readFileSync(path,"utf8"))(w); return w[key]; }
  catch { return null; }
}

// --- merge freshly-fetched seasons into existing per-entity data (preserves history) ---
// existing/fresh are { name: { seasons: { '2025': ... } } }. Mutates + returns existing.
export function mergeSeasons(existing, fresh){
  for (const [name, d] of Object.entries(fresh)) {
    (existing[name] ||= { seasons:{} });
    Object.assign(existing[name].seasons, d.seasons);
  }
  return existing;
}

// --- unzip a single-entry zip in pure Node (used by the NBA + NHL fetchers) ---
export function unzipSingle(buf){
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip file");
  const method = buf.readUInt16LE(8);
  let compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (compSize === 0) { const cd = buf.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); compSize = buf.readUInt32LE(cd + 20); }
  const comp = buf.subarray(start, start + compSize);
  return method === 0 ? comp : inflateRawSync(comp);
}

// ===================== MLB transforms =====================
// Statcast batted-ball hit coords -> spray angle in degrees (0=center, neg=left,
// pos=right). Returns null for non-finite input or foul balls (|angle|>48).
export function hitAngle(hx, hy){
  if (!isFinite(hx) || !isFinite(hy)) return null;
  let a = Math.atan2(hx-125.42, 198.27-hy) * 180/Math.PI;
  if (!isFinite(a) || Math.abs(a) > 48) return null;
  return Math.max(-47, Math.min(47, a));
}
// Statcast `events` string -> our 4 chart buckets (null = not a batted ball we chart).
export function outcomeOf(ev){
  if (ev==='single') return 'Single';
  if (ev==='double' || ev==='triple') return 'Double';
  if (ev==='home_run') return 'Home run';
  if (/out|play|choice|error|sac/.test(ev)) return 'Out';
  return null;
}
// Average pfx movement (feet) -> break in inches. Sign flip on horizontal so
// arm-side is positive; vertical is induced ride (positive = rides).
export function pitchBreak(hxAvgFt, vzAvgFt){
  return { hb: +(-hxAvgFt*12).toFixed(1), vb: +(vzAvgFt*12).toFixed(1) };
}

// ===================== NBA transforms =====================
export const HOOP_Y = 5.25;
export const NBA_ZONE_AREA = {
  "Restricted Area": "At the rim",
  "In The Paint (Non-RA)": "Close range",
  "Mid-Range": "Mid-range",
  "Left Corner 3": "3-pointers", "Right Corner 3": "3-pointers", "Above the Break 3": "3-pointers",
};
// Raw LOC_X/LOC_Y -> our court coords {x,y}, or null if off our modeled court.
export function nbaShotCoord(locX, locY){
  const x = +locX, y = +locY - HOOP_Y;
  if (!isFinite(x) || !isFinite(y) || y < -2 || y > 42) return null;
  return { x:+x.toFixed(1), y:+y.toFixed(1) };
}

// ===================== NFL transforms =====================
export function nflOutcome(td, intc, comp){ return td ? "TD" : intc ? "INT" : comp ? "C" : "I"; }
export function nflLane(loc){ return loc==="left" ? -1 : loc==="right" ? 1 : 0; }

// ===================== NHL transforms =====================
// MoneyPuck `event` -> did this shot attempt score? (GOAL vs SHOT-on-net vs MISS)
export function isGoal(event){ return event === "GOAL"; }
