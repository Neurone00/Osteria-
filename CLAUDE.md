# CLAUDE.md

Context for anyone — human or agent — picking this repo up cold.

## What this is

Osteria: three Italian card games (Scopa, Rubamazzo, Straccia camicia) for **two players on two devices**, joined
by a four-letter table code. Aiming at a playable MVP hosted on Cloudflare, not a product.

Read `README.md` first — it documents the rules as implemented, with the reasoning behind the variant choices.
Those rules were researched against Italian sources and verified by simulation; **don't "fix" them from memory.**
Two that look like bugs and aren't:

- Straccia camicia attacks on **asso, due, tre** (paying 1, 2, 3). The A4/R3/C2/F1 scheme is the *international*
  variant, available behind a toggle. The Italian baseline is the default and is correct.
- Scopa forces the single-card capture: if a table card matches your card's value exactly, you may not take a sum
  instead. Intentional.

## Layout

```
src/App.jsx        everything: rules engines, transports, UI, motion. ~1500 lines, single file on purpose
src/main.jsx       React root for the Vite build
worker/index.js    Cloudflare Worker: serves the game, one Durable Object per table code
wrangler.toml      name = "neurone00", assets + DO binding
scripts/           build-standalone.mjs inlines the app into standalone/index.html
standalone/        generated — the single file Cloudflare uploads. Never hand-edit
```

## Invariants

- **`src/App.jsx` must keep running unmodified as a Claude artifact.** That means: no `localStorage`, no
  `sessionStorage`, and no imports beyond `react` on any code path that runs when `window.storage` exists. The
  browser-storage calls that do exist are gated behind `!hasStore()` and wrapped in try/catch. Keep it that way.
- **Three transports, chosen at runtime, same state shape on all of them:** `window.storage` shared keys in the
  artifact; a WebSocket to `/room/CODE` when served by the Worker; PeerJS as the fallback for dumb static hosts.
  Adding a fourth is fine; branching the state shape is not.
- **One writer per move.** The player whose turn it is computes the whole next state, bumps `v`, and sends the
  lot. Receivers adopt anything with a higher `v` and ignore the rest. Turn-based play means writes never race —
  don't introduce partial/delta updates without solving that.
- **`standalone/index.html` is a build artifact.** Edit `src/App.jsx`, then `npm run bundle`. `npm run deploy`
  runs the bundle first via `predeploy`, so the deployed asset can't go stale.
- **The slam is the design.** Overshoot animation, screen jolt, synthesised thwack, haptic tap, all firing on both
  players' screens. Everything else is deliberately quiet — paper grey, hairlines, SVG pips, no chrome. Don't add
  decoration; don't remove the `prefers-reduced-motion` guards or the sound toggle.
- **Pull-to-refresh must stay disabled** (`overscroll-behavior: none` plus the `touchmove` guard), and the session
  restore on boot must keep working. Losing a hand to a stray thumb was the specific thing this fixes.

## State shape

```js
room = {
  code, v, ts,
  names: { A, B },              // A is the host, B is the guest
  status: "lobby" | "play",
  game: "scopa" | "ruba" | "camicia",
  opts: { ... },                // house rules, host-controlled
  gs,                           // game state, shape depends on game
  log: [string],                // last 3 events
  anim: { id, kind, card, seat } // drives the slam on both clients
}
```

## Commands

```bash
npm install
npm run dev        # vite, localhost:5173 — two browser tabs won't share a table, use two devices or two profiles
npm run bundle     # regenerate standalone/index.html
npm run deploy     # bundle + wrangler deploy
npm run tail       # live Worker logs
npx wrangler deploy --dry-run --outdir=/tmp/w   # validates config without touching the account
```

## Known gaps

Roughly in the order worth doing:

1. **Never tested on two real devices.** Everything so far is simulation and headless rendering. First job after
   deploying: two phones, all three games, a hand each.
2. **Hands live in the shared state object.** A determined opponent can read yours off the wire. Fine among
   friends, wrong for anything competitive. Fixing it properly means moving rule enforcement into the Durable
   Object and sending each player a redacted view — a real refactor, not a patch.
3. **The rules engines are welded into `App.jsx`.** Extracting them into `src/rules.js` would make them
   importable by a test file. There is no test suite; the engines were verified by an ad-hoc simulation that
   played 900 random deals checking for card leaks, stuck states and non-terminating hands. Recreating that as
   `scripts/simulate.mjs` is cheap and worth it before touching any rule.
4. **Reconnect is a page reload.** The "Reconnect" control in the header reloads and rejoins from the saved
   session. A proper WebSocket retry with backoff would be smoother.
5. **No spectators, no more than two seats, no rematch history beyond the running tally.** All deliberate.
6. Sicilian slap rule for Straccia camicia is deliberately absent: network latency would decide the race instead
   of reflexes. Don't add it without solving that.
