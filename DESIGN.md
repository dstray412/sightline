# SIGHTLINE — Design System

The design decisions behind SIGHTLINE, so new sports (NHL, Golf), new views, and a
future landing page stay consistent. This documents what's *already true* in
`index.html` — treat it as the source of truth when adding anything visual.

**Product in one line:** a self-contained, double-click sports-data visualization tool
that shows insights *on the playing surface* and explains them in plain English —
"sports data, seen differently."

---

## 1. First principles

1. **The visualization is the hero.** Everything else (controls, legends, chrome) serves it. Never let controls dominate the frame.
2. **The insight is the promise.** Every view pairs with a plain-English "THE READ" takeaway that a non-sports-fan understands. It gets real visual presence, never fine print.
3. **Visualize on the playing surface.** Prefer real spatial context — a court, a diamond, a football field, a rink, a green — over abstract bars. Spatial > generic chart.
4. **Red is hot, blue is cold.** One heat law across the whole app: high value = red, low value = blue; darker red = hotter, lighter blue = cooler. No exceptions in data colors.
5. **No orange, no purple, no grey in data.** Settled palette taste. (Cyan/violet appear only in brand chrome, never to encode data.)
6. **Self-contained.** Opens by double-click, works offline. Self-host fonts, no external CDNs, no build step. One `index.html` + data files.
7. **Understandable to anyone.** Plain-spoken titles and insights. No jargon without immediately explaining it.

---

## 2. Color

### CSS variables (`:root`)
| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#07080c` | near-black page background |
| `--panel` | `rgba(255,255,255,0.04)` | raised surfaces (chips, insight) |
| `--line` | `rgba(255,255,255,0.09)` | hairline borders |
| `--text` | `#eef1f7` | primary text |
| `--muted` | `#a6b0c4` | secondary text (meets contrast on `--bg`) |
| `--accent` | `#38e1ff` | cyan — brand, active state, focus rings, "THE READ" eyebrow |
| `--accent2` | `#7c5cff` | violet — brand gradient + background glow ONLY (never data) |

Page background = `--bg` plus two soft radial glows (violet top-right, cyan bottom-left). Chrome only.

### The heat scale (signature)
`heatColor(t)`, `t` in [0,1] — light blue (cold/low) → warm blush-white → dark red (hot/high):
```
stops = [[206,231,255],[92,160,220],[242,230,232],[212,66,74],[132,18,30]]
```
- Low/cold values → light blue. High/hot values → dark red. Warm blush-white is the neutral crossover (NOT grey).
- `ppsColor(pps) = heatColor((pps-0.7)/0.75)` maps basketball points-per-shot into the scale; other views normalize their own metric the same way.
- `heatGlow(t)` adds `shadowBlur` only on the hot half (t>0.5) so dark-red peaks pop against the dark UI without brightening the cold end. Cold stays flat.
- Alpha usually encodes *frequency/volume* (how often), while hue encodes *value* (how good).

### Categorical data colors (ranked along the heat law where possible)
- **Baseball spray** (`SPRAY`): out `#b3d4f0` (light blue) · single `#5d97cf` · double `#cc3a46` · home run `#7a101c` (dark red). Value rank = coldest→hottest.
- **Football passes** (`NFL_OUT`): complete `#eef2f9` (white, the common baseline) · incomplete `#6f9bd0` (blue) · touchdown `#f2c94c` (gold) · interception `#e0483f` (red). *Note:* passes are categorical events, not a heat scale — gold/red/white/blue are chosen for max mutual contrast on the black field, TD is celebratory gold, INT is alert red.
- **Pitch types** (`MLB_TYPES`, qualitative — 9 distinguishable hues, no orange/purple): 4-Seam `#d8434f` · Sinker `#e8b83b` · Cutter `#4dc4b0` · Slider `#38e1ff` · Curveball `#5b8fd6` · Changeup `#5fce8f` · Sweeper `#9fd0ff` · Splitter `#b6e26e` · Slurve `#e08fb4`.
- **Compare overlay** A/B: A `#5b9bd8` (blue) · B `#d8434f` (red).

**Rule for a new categorical set:** if the categories are *ordinal by value* (out→single→double→HR), rank them along the heat law. If they're *nominal events* (pitch types, pass outcomes), pick maximally distinct hues that avoid orange/purple/grey, and make the two most common categories the most distinct.

---

## 3. Typography

- **Display:** `--display` = `'Space Grotesk'` (self-hosted at `fonts/`, variable, weights 500–700). Used for the wordmark, subtitles/eyebrows, view titles, "THE READ" label, and the canvas empty-state. Geometric grotesk = techy, precise, sporty.
- **Body/UI:** `ui-sans-serif, system-ui, sans-serif` stack (15px base).
- Fonts are self-hosted (relative `@font-face`) so they render offline. Never add a font CDN — it breaks the offline/self-contained rule.

### Scale
| Role | Size / weight / tracking | Font |
|------|--------------------------|------|
| Wordmark (`.logo`) | 20px / 700 / .14em, cyan→violet gradient text | display |
| Eyebrow (`.subtitle`, `THE READ`) | 11–12.5px / 600 / .16–.20em / UPPERCASE, cyan | display |
| View title (`.viztitle`) | 24px / 700 / -.01em | display |
| Insight body (`.insight`) | 16px / 1.6 line-height, `--text` | body |
| Body / controls | 13–15px | body |
| Legend | 13px, `--muted` | body |

**Minimums (a11y):** body/insight text ≥ 16px; never put load-bearing text below ~12px; keep contrast ≥ 4.5:1 on `--bg`.

---

## 4. Layout & spacing

- Centered column, `max-width: 1040px`, padding `26px 24px` desktop / `14px 11px` mobile.
- **Stage** = the main panel: `border-radius: 20px`, `1px solid --line`, subtle top-light gradient, `padding: 20px` (14px mobile).
- **Radii:** stage 20px · panels/insight/tooltip 12px · view buttons/toggles 9px · chips 999px (pill).
- Vertical rhythm top→bottom: brand → **eyebrow + title** → controls (player chips, view buttons, season, compare) → **canvas (hero)** → **THE READ (insight)** → legend → footer.
- Keep the control stack tight so the canvas starts high. Controls are compact on desktop (mouse); touch targets grow to 44px only under `@media (pointer: coarse)`.

---

## 5. Components

- **Sport tabs** (`.sport`): segmented control, top-right. Active = cyan/violet tinted + inset ring.
- **Chips** (`.chip`): pills for players/seasons/matchup. Active = solid cyan gradient on dark text. One-tap, all visible (good up to ~12 items; past that, move to a searchable selector).
- **View buttons** (`.viewbtn`): outline buttons; active = subtle gradient + inset ring.
- **Compare toggle** (`.cmp-toggle`) + **Overlay toggle**: same button family.
- **THE READ** (`.insight`): the takeaway panel — cyan-tinted background, "THE READ" display eyebrow, 16px full-contrast copy. Player names wrapped in `.k` (cyan). This is the most important non-canvas element.
- **Legend** (`.legend`): dots (`.dot`, colored, soft glow) for categories, or the `.grad` bar (the heat scale) for continuous value, plus a muted "what brightness/size means" note.
- **Tooltip** (`.tooltip`): dark card on hover (desktop) / tap (touch); bold cyan key value.
- **Focus:** every interactive control gets a `2px solid --accent` focus-visible ring.

---

## 6. Canvas / chart conventions

- One `<canvas>`, DPR-aware, 2D context. Each view has a desktop and a taller mobile aspect ratio (portrait phones get more height).
- **Spatial surface first:** draw the real context — faint basketball court, baseball diamond + outfield fence, black football field with yard lines. New sports get their surface (NHL rink, golf hole/green).
- **Encoding:** hue = value (heat scale), alpha = frequency/volume, glow = hot values only, size = magnitude where relevant.
- **Animation:** ~900ms ease-out (`1-(1-t)^3`) with a per-item stagger on appear. Calm, not flashy.
- **Empty state:** if a player/season/matchup has no data, `drawEmptyState()` shows "No data for X here / try another season" centered — never a blank canvas.
- **Accessibility:** the canvas is `role="img"` with its `aria-label` synced to the plain-English insight, so screen readers get the same read.

---

## 7. Voice & copy

- Plain, confident, non-jargony. Titles are plain-spoken: "Where a scorer is deadly", "How deep he throws — and how often it connects".
- The insight always says what the colors/positions *mean* in human terms ("deep red = hot, light blue = cold"). Explain every encoding inline.
- "THE READ" = the takeaway (sports vernacular for reading the game). Keep it.
- No hype, no filler. If deleting 30% of a sentence improves it, delete it.

---

## 8. Adding a new sport or view (the pattern)

The app dispatches every view through a single `VIEWS[name]` registry. To add one:

1. **Data:** add a `fetch-<sport>.mjs` that writes `window.SIGHTLINE_<SPORT>`, reusing `pipeline.mjs` helpers (`splitCsv`, `sample`, `loadExisting`, `mergeSeasons`) and adding pure transforms there (tested in `pipeline.test.mjs`).
2. **Surface:** write a `draw<Surface>()` that renders the real playing surface (rink, green) the way `drawFootballField()` / `drawField()` / `drawCourt()` do.
3. **Register the view:** add one `VIEWS['<view>'] = { build, draw, legend, insight, hit, aspD, aspM, seasons }` entry, plus append to the declarative tables (`VIEW_META`, `SPORT_VIEWS`, `ENTITY`). No other files need editing — that's the whole point of the registry.
4. **Encode with the heat law:** value → `heatColor`/`ppsColor`, hot glow → `heatGlow`. Categorical? Follow §2's rule.
5. **Pair with a plain-English insight + a legend.** Not optional — it's the promise.
6. **Verify:** it renders on desktop + mobile, has an empty state, and the canvas `aria-label` reads correctly.

---

## 9. Known deferred design work

- **Landing page** — first marketing surface; apply landing-page composition (poster-first hero, brand-loud) rather than app-UI rules.
- **Bigger player selector** — chips are fine to ~12; a searchable selector when the roster grows.
- **Data-load error banner** — graceful message if a data file fails (today a missing file degrades to sample/hidden; a corrupt one is a blank screen).
