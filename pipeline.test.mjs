// Tests for the pure pipeline logic. Run: node --test  (Node 18+, no installs)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitCsv, sample, mergeSeasons,
  hitAngle, outcomeOf, pitchBreak,
  nbaShotCoord, HOOP_Y,
  nflOutcome, nflLane,
} from "./pipeline.mjs";

test("splitCsv: plain, quoted-with-comma, escaped quotes, empty fields", () => {
  assert.deepEqual(splitCsv("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(splitCsv('a,"b,c",d'), ["a", "b,c", "d"]);         // comma inside quotes
  assert.deepEqual(splitCsv('a,"she said ""hi""",b'), ["a", 'she said "hi"', "b"]); // escaped quotes
  assert.deepEqual(splitCsv("a,,c"), ["a", "", "c"]);                 // empty middle field
  assert.deepEqual(splitCsv(""), [""]);                               // empty line
});

test("sample: returns original under cap; downsamples deterministically, order preserved", () => {
  const small = [1, 2, 3];
  assert.equal(sample(small, 10), small);                            // under cap => same ref
  const big = Array.from({ length: 100 }, (_, i) => i);
  const s = sample(big, 10);
  assert.equal(s.length, 10);
  assert.deepEqual(s, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);      // deterministic stride
  assert.deepEqual(s, sample(big, 10));                              // stable across runs
});

test("mergeSeasons: adds new season, overwrites same season, adds new entity", () => {
  const existing = { Curry: { seasons: { 2024: "old24", 2025: "old25" } } };
  const fresh = { Curry: { seasons: { 2025: "new25", 2026: "new26" } }, Booker: { seasons: { 2026: "b26" } } };
  const merged = mergeSeasons(existing, fresh);
  assert.deepEqual(merged.Curry.seasons, { 2024: "old24", 2025: "new25", 2026: "new26" }); // history kept, current replaced
  assert.deepEqual(merged.Booker.seasons, { 2026: "b26" });          // new entity created
});

test("hitAngle: center=0, left<0, right>0, fouls/non-finite=null, clamped to +-47", () => {
  assert.equal(Math.round(hitAngle(125.42, 100)), 0);                // dead center
  assert.ok(hitAngle(100, 150) < 0);                                 // pulled left
  assert.ok(hitAngle(150, 150) > 0);                                 // pushed right
  assert.equal(hitAngle(200, 190), null);                            // |angle| > 48 => foul, dropped
  assert.equal(hitAngle(NaN, 100), null);
  assert.equal(hitAngle(125.42, "x"), null);
  const a = hitAngle(60, 195);
  assert.ok(a >= -47 && a <= 47);                                    // always clamped in-range
});

test("outcomeOf: batted-ball buckets; non-batted-balls => null", () => {
  assert.equal(outcomeOf("single"), "Single");
  assert.equal(outcomeOf("double"), "Double");
  assert.equal(outcomeOf("triple"), "Double");
  assert.equal(outcomeOf("home_run"), "Home run");
  assert.equal(outcomeOf("field_out"), "Out");
  assert.equal(outcomeOf("grounded_into_double_play"), "Out");
  assert.equal(outcomeOf("sac_fly"), "Out");
  assert.equal(outcomeOf("walk"), null);
  assert.equal(outcomeOf("hit_by_pitch"), null);
  // QUIRK (locked intentionally): "strikeout" matches /out/, but fetchHitter drops it
  // downstream because a strikeout has no hit coords (hc_x/hc_y non-finite). Documented, not a live bug.
  assert.equal(outcomeOf("strikeout"), "Out");
});

test("pitchBreak: horizontal sign flip + feet->inches, vertical ride", () => {
  assert.deepEqual(pitchBreak(-0.5, 1.3), { hb: 6, vb: 15.6 });      // glove-side avg -> arm-side positive
  assert.deepEqual(pitchBreak(0.6, -1.0), { hb: -7.2, vb: -12 });
});

test("nbaShotCoord: applies hoop offset, rejects off-court + non-finite", () => {
  assert.equal(HOOP_Y, 5.25);
  assert.deepEqual(nbaShotCoord(10, 25.25), { x: 10, y: 20 });       // y shifted by HOOP_Y
  assert.equal(nbaShotCoord(0, 100), null);                          // beyond half court
  assert.equal(nbaShotCoord(0, 0), null);                            // y = -5.25 < -2
  assert.equal(nbaShotCoord("x", 10), null);
});

test("nflOutcome: TD > INT > complete > incomplete precedence", () => {
  assert.equal(nflOutcome(true, false, false), "TD");
  assert.equal(nflOutcome(false, true, false), "INT");
  assert.equal(nflOutcome(false, false, true), "C");
  assert.equal(nflOutcome(false, false, false), "I");
  assert.equal(nflOutcome(true, true, true), "TD");                  // TD wins
});

test("nflLane: left/right/middle -> -1/1/0", () => {
  assert.equal(nflLane("left"), -1);
  assert.equal(nflLane("right"), 1);
  assert.equal(nflLane("middle"), 0);
});
