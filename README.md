# Osteria

Six two-player games for two people on two devices, joined by a four-letter table code — or by scanning a QR /
opening a shared link. One player opens a table, the other joins. No accounts, no lobby lists, no server of your own.

- **Scopa** (three cards) — with settebello, primiera, and optional napola, rebello, asso piglia tutto, asso in pila
- **Rubamazzo** — take the table, or steal the whole pile off your opponent
- **Straccia camicia** — no decisions at all, just nerve and the order of the deck
- **Briscola** — trump-suit trick-taking, 120 points over twenty tricks
- **Perudo** (dice) — five hidden dice each, bid on a face across all dice or call Dudo; shake to roll
- **Yahtzee** (dice) — three rolls a turn, thirteen scoring boxes, the +35 upper bonus; shake to roll
- **Diecimila** (dice) — six-dice press-your-luck; roll on to pile up points, but a scoreless roll (a *Farkle*) burns the turn

Card games begin with a shuffle-and-cut ritual: one player taps the deck to shuffle (the randomness is seeded by
the rhythm of their taps), the other drags to cut. Dice games throw on a phone shake (or a tap).

Cards land with a slam: overshoot animation, screen jolt, a synthesised thwack, and a haptic tap on phones.
Sound and haptics can be turned off in the header; the whole motion set respects `prefers-reduced-motion`.

Cards land with a slam: overshoot animation, screen jolt, a synthesised thwack, and a haptic tap on phones.
Sound and haptics can be turned off in the header; the whole motion set respects `prefers-reduced-motion`.

## Deploy to Cloudflare

The Worker in `worker/index.js` serves the game *and* runs the tables, so one command puts everything live:

```bash
npm install
npx wrangler login       # once
npx wrangler deploy      # → https://osteria.<your-subdomain>.workers.dev
```

`wrangler.toml` is already set to `name = "osteria"`. Change that line to rename the Worker; add a
`[[routes]]` block with `custom_domain = true` to put it on your own domain.

What you get:

- **Static game at the edge.** `standalone/index.html` is uploaded as a static asset and served without invoking
  Worker code.
- **A Durable Object per table.** `idFromName("ABCD")` means both phones dialling the same four letters reach the
  same object, wherever they are, over one WebSocket each. No polling, no PeerJS, no third-party broker.
- **Tables that outlive their players.** The object stores the last state it saw, so a reload — or the host
  closing the tab entirely — rejoins the hand exactly where it stopped. Abandoned tables wipe themselves after a
  day via a Durable Object alarm.
- **Free plan compatible.** The migration uses `new_sqlite_classes`, which is the storage backend free accounts
  get. Sockets are accepted with `ctx.acceptWebSocket`, so hibernation keeps idle tables from burning duration.

Check it's live: `npx wrangler tail` while someone plays a card.

The client picks its transport at runtime, so nothing needs configuring. Served from the Worker, it uses the
WebSocket relay. Served from a dumb static host with no `/room/CODE` endpoint, the handshake times out after
2.5 seconds and it falls back to PeerJS by itself.

## Other ways to get it online

`standalone/index.html` is the whole game in one 174 KB file — React and all — with no build step and no
dependencies to install. Pick whichever is quickest for you:

1. **Netlify Drop** — open <https://app.netlify.com/drop> and drag the `standalone` folder onto the page.
   You get an HTTPS URL in about twenty seconds. No account needed to start, no CLI, no git.
2. **GitHub Pages, no terminal** — make a repo on github.com, use *Add file → Upload files* to drop in
   `standalone/index.html` as `index.html`, then Settings → Pages → Deploy from branch → `main` / root.
   Live in a minute or two at `username.github.io/reponame`.
3. **Cloudflare Pages / Vercel** — same drag-and-drop story, point them at the `standalone` folder.

Send the URL to the other player, one of you opens a table, the other types the four letters. That's the MVP.

The full Vite project below is the same app, for when you want to edit it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm test           # jsdom boot check, then 300 random deals of each variant
```

`npm test` is two things. `scripts/smoke.mjs` mounts the built page in jsdom and checks the lobby is on
screen. `scripts/simulate.mjs` plays 300 random deals of each of the six variants — both scopa rule sets,
both rubamazzo, both camicia — asserting that all 40 cards are accounted for after every single play, that
no seat is ever left on turn with nothing it can do, that every hand terminates, and that each scopa
scoreboard adds up to the lines that explain it.

## Put it online

The build is a plain static folder. Any of these work:

**GitHub Pages** — push to a repo, then Settings → Pages → Source: *GitHub Actions*.
The workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`.

```bash
git init && git add . && git commit -m "Osteria"
gh repo create osteria --public --source=. --push     # or add a remote by hand
```

**Netlify / Vercel / Cloudflare Pages** — build command `npm run build`, publish directory `dist`.

**Anywhere else** — upload `dist/` to any static host. `base: "./"` in `vite.config.js` keeps the paths relative,
so it works from a subfolder too.

Serve it over HTTPS. WebRTC connections and haptics need a secure context.

## Surviving a reload

Phones reload games at the worst moments — a pull-to-refresh while reaching for a card, a stray swipe, a browser
tab waking up. Three defences:

- **The pull gesture is disabled.** `overscroll-behavior: none` plus a `touchmove` guard that cancels downward
  drags at scroll top, so tugging the screen never triggers a refresh.
- **A reload asks first**, via `beforeunload`, whenever a hand is in progress.
- **If it happens anyway, you land back in the game.** The table code, seat and name are saved on every move
  (private artifact storage, or `sessionStorage` when self-hosted). On start-up the app rejoins that table
  automatically. In the self-hosted build the host also keeps the full game state, so a host reload restores the
  hand and pushes it back to the guest; the guest retries the connection a few times before giving up. **Leave**
  is the only thing that clears the session.

A host reload does briefly free the PeerJS id, so the app retries claiming it for a few seconds. If the guest
shows *disconnected*, the **Reconnect** control in the header re-runs the handshake.

## How two phones stay in sync

`src/App.jsx` picks its transport at runtime:

| Where it runs | Transport |
| --- | --- |
| Inside a Claude artifact | `window.storage` shared keys, polled every 1.2 s |
| On the Cloudflare Worker | WebSocket to `/room/CODE`, relayed and persisted by a Durable Object |
| Any other static host | WebRTC data channel via [PeerJS](https://peerjs.com), loaded from a CDN at runtime |

For the self-hosted path the host's browser registers the peer id `osteria-tavolo-CODE` on PeerJS's free public
broker, and the guest dials that id. After the handshake the two phones talk directly — the broker only introduces
them. Nothing is stored, so a table dies when the host closes the tab. If you'd rather not depend on the public
broker, run [peerjs-server](https://github.com/peers/peerjs-server) and pass `{ host, port, path }` to the `Peer`
constructor in `openPeer`.

Whole-state messages, one authoritative writer per move: the player whose turn it is computes the next state,
stamps a version number on it, and sends the lot. The other side adopts anything with a higher version.
Turn-based play means writes never race.

One honest caveat: hands live in the shared state object, so a determined opponent could read yours out of memory
or off the wire. Fine for a game with a friend, not for money.

## Rules as implemented

Forty-card Italian deck: asso, 2–7, fante (8), cavallo (9), re (10) in denari, coppe, spade and bastoni.

### Scopa

Three cards each, four face up. The dealer alternates; the non-dealer leads. Three more each when both hands empty,
until the deck runs out. The last player to capture sweeps whatever is left on the table — that last sweep is never
a scopa, and neither is any capture on the final play of a deal.

- Play a card to take a table card of the same value, or a set of cards that sums to it.
- If a single card of that value is on the table, you must take that single card — sums are not allowed instead.
- Where several sets are legal, you choose.
- Clearing the table is a **scopa**, one point.
- End of deal: one point each for **carte** (most cards), **denari** (most coins), **settebello** (7 of denari),
  and **primiera**, plus every scopa. Primiera counts the best card in each suit at 7→21, 6→18, A→16, 5→15, 4→14,
  3→13, 2→12, figures→10; it is void for anyone missing a suit entirely.
- Match goes to 11 by default, switchable to 16 or 21.

Optional house rules, toggled by the host:

- **Asso piglia tutto** — an ace sweeps the whole table. Per the UIGC reading, that sweep does not score a scopa,
  unless the only card on the table was an ace.
- **Rebello** — the re di denari is worth a point, like the settebello.
- **Napola** — asso, due and tre of denari together score 3, plus one for each further denaro continuing the run.

### Rubamazzo

Same deal as scopa. Captures go face up beside you and only the top card shows.

- Match a table card and take it — if several table cards share that value, they all come with it.
- Match the exposed top card of your opponent's pile and the entire pile moves to you. Piles are stolen by direct
  value match only, never by a sum.
- No captures? The card stays on the table.
- Table remainder goes to the last player who captured. Most cards wins.
- **Northern sums** toggle allows scopa-style addition for table captures.

### Straccia camicia

Also *tras in camisa*, *cavacamisa*, *restà 'n camisa*, *strazza camisa* — twenty cards each, face down, nobody
chooses anything.

- Turn your top card onto the middle.
- **Asso, due and tre** are the attacking cards, demanding 1, 2 or 3 cards from the other player.
- Turn an attacking card while paying, and the debt reverses onto your opponent.
- Pay in full without one, and the attacker takes the whole middle pile under their packet, unshuffled, and leads
  again.
- Run out of cards and you lose — left standing in your shirt.
- **Figure variant** toggle switches to the international scheme: asso 4, re 3, cavallo 2, fante 1.

A famous 2017 result showed a 40-card deal that loops forever, so the app calls a draw after 900 flips.

Sicily plays a slap rule — matching cards mean first hand on the pile takes it. It isn't implemented here, because
network latency would decide the race instead of your reflexes.

### Diecimila

The traditional osteria dice game — elsewhere *10.000*, and the same family as Farkle. Six dice, one cup, pure
press-your-luck. On your turn you roll, set aside at least one scoring die, then choose: bank what you've gathered,
or roll the rest and risk it. A roll that scores *nothing at all* is a **Farkle** — the whole turn's points are
gone and play passes.

Scoring:

- a single **1** = 100, a single **5** = 50
- **three 1s** = 1000; three of any other = face × 100 (three 2s = 200 … three 6s = 600)
- **four / five / six of a kind** double the triple, then double again, then again — ×2, ×4, ×8 (four 1s = 2000,
  six 1s = 8000)
- a **1-2-3-4-5-6 straight** = 1500; **three pairs** = 1500

Clear all six dice as scoring and they turn **hot** — roll all six again, the turn's points carried. First to the
target (2500 / 5000 / 10000, default 5000) opens a **last round**: the other player gets one final turn to overtake,
then the higher score wins. Two optional house rules: an **opening threshold** (gather 500 in a single turn before
your first bank) and turning the last round off (first past the target wins outright).

Only 1s and 5s score on their own; a lone 2, 3, 4 or 6 is dead, so the app won't let you set one aside — you keep
only dice that actually earn.

## Layout

```
wrangler.toml         Cloudflare config: assets + Durable Object binding
worker/index.js       Worker: serves the game, relays each table
standalone/index.html one-file build, drag onto any static host
index.html            entry, loads src/main.jsx
src/main.jsx          React root
src/App.jsx           everything else: rules engines, transport, UI, motion
vite.config.js        relative base for static hosting
.github/workflows     Pages deploy
```

The same `App.jsx` runs unmodified as a Claude artifact.
