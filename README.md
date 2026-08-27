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
- **Azzardo** (dice) — a two-player dice deck-builder: root a skill-tree "Path" from a 1 or a 2, and Yahtzee-style goals on each throw let you claim upgrades; highest total after twenty throws wins
- **Bestiario** (board) — a 5×5 duel of two Masters and eight Students, moved by animal cards that rotate between the players
- **Flotta** (board) — battaglia navale on an 8×8 grid, but ships can maneuver and each side has three one-shot powers
- **Il Paroliere** (dice) — the Italian Boggle: a 4×4 tray of letter dice, three minutes, find more words than your opponent

Card games begin with a shuffle-and-cut ritual: one player taps the deck to shuffle (the randomness is seeded by
the rhythm of their taps), the other drags to cut. Dice games throw on a press-and-hold: the longer you hold, the
more the throw's seed is stirred — the dice cousin of the tap-timed shuffle.

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
| No network at all | **Web Bluetooth** — both phones connect to a shared Osteria BLE service and sync over it |

### Bluetooth (offline, no network)

On the home screen, under **Bluetooth**, one phone taps **Host** and the other **Join** (Web Bluetooth needs Chrome
on Android or desktop). Because a browser page can only be a BLE *central*, never a peripheral, the two phones can't
pair directly — they meet on a shared **Osteria GATT service** and sync the room over one notify+write
characteristic, the state JSON fragmented into short `[msgId, total, index]` frames (a BLE write is MTU-capped) and
reassembled on the far side. That shared service is the one piece that has to live outside the browser: run the
bundled relay on any machine with Bluetooth —

```bash
npm install @abandonware/bleno
npm run bt-relay        # advertises as "Osteria"; connect both phones to it
```

— or point the phones at any peripheral exposing the same service UUID (`scripts/bt-relay.mjs` has it). No Wi-Fi, no
internet, no server. It's the same one-writer-per-move state as every other transport.

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

### Azzardo

A two-player **dice deck-builder** — a legible "dice Balatro." You each start with a **coin** (a d2) and pick which
face, **1 or 2**, roots your **Path**: a small skill tree of upgrades. The two starts are balanced but open different
early branches that **cross** deeper in, so 1 and 2 play out as different "classes" that can still reach the same apex.

Every throw scores — number dice add up, **× dice** multiply (a × that rolls a 1 whiffs to ×1), and the **combo** your
number dice make (pair, triple, straight, full, five) adds a bonus: `score = (sum + flat charms + combo bonus) × the
× dice`. And, **Yahtzee-style**, the throw decides which Path nodes you can claim: every node names a **goal** the roll
must meet — an easy sum, a pair, a big total, a full house — and the harder the goal, the stronger the reward (evolve a
die up the d2 → d20 ladder, add a number or × die, a flat charm, a combo amp, or the apex that grants both). After the
throw you **claim one node you qualified for, or pass**. Twenty throws each, **highest total wins**.

Play is strictly turn-based (choose a root once, then throw + claim, then the other player), which keeps it on the
one-writer sync rule with no simultaneous-write merge; the throw is seeded by the press-and-hold, like every dice game.

### Bestiario

A small abstract duel on a 5×5 board — the mechanics of *Onitama*, reskinned with Italian animal cards. Each side
starts with a **Maestro** (marked with a dot) on its central temple and four **Allievi** either side of it.

Five cards are dealt from sixteen: two to each player, one left aside as the **spare**. A card is a little pattern
of steps. On your turn you **pick a card, pick a piece, and move it** by that pattern — landing on an enemy piece
captures it. Then the card you used slides to the spare and you take the old spare into your hand, so the four live
cards keep rotating between the two players and nobody's options stay fixed. The opponent's cards are always face
up, drawn rotated toward you, so the whole game is open information — which is why it sits cleanly on the shared
wire with nothing to hide.

Two paths to victory:

- **Via della Spada** — capture the enemy Maestro.
- **Via del Fiume** — walk your own Maestro onto the enemy's temple (the centre square of their back row).

If you're ever completely blocked — no legal move with either card — you still swap one card with the spare and pass
the turn. The spare card's colour decides who moves first, so there's no coin-flip advantage.

### Flotta

Battaglia navale — Battleship — with two twists that make the classic game move. The grid is a roomier **8×8**, and
the fleet is a **corazzata (4)**, two **incrociatori (3)** and a **cacciatorpediniere (2)**. Each side lays its
ships out in secret, then locks in; the battle opens once both fleets are down.

On your turn you spend a single action:

- **Fuoco** — fire at one enemy cell. Hit, miss, or *colpito e affondato* when a shot finishes a ship.
- **Manovra** — instead of firing, slide one of your ships one cell to dodge. This is the twist: your shot pegs
  stay stuck to the water where you fired, so when a ship moves it slips out from under the enemy's marks — while
  the damage it has already taken travels with its hull.

Plus three **powers, one use each**:

- **Salva** — fire up to three shots in one turn.
- **Sonar** — reveal whether ships sit in a 3×3 patch of enemy water (your best answer to a fleet that keeps
  moving).
- **Riparazione** — heal one hit on one of your ships.

Sink the entire enemy fleet to win. Like the card games, the fleets live in the shared state and are hidden only in
the interface — fine among friends, readable by a determined snoop off the wire (see *Known gaps* in `CLAUDE.md`);
enforcing real secrecy would need the Durable Object to hand each player a redacted view.

### Il Paroliere

The Italian **Boggle**. A **4×4** tray of letter dice, a **three-minute** timer (2 / 3 / 4 min are selectable), and
both players hunt words at once. A word must be **≥3 letters** and trace a path through **adjacent dice** — diagonals
included — never reusing a die.

Input is a **simplified on-screen keyboard**: just the Italian letters, no accents, no autocorrect, so nothing leaks
and nothing gets "helpfully" changed. Tapping a die on the board also appends its letter. **Q always rides with u** as
a single **"Qu"** die that counts as two letters. Keys for letters not on the current board are dimmed.

The app enforces the two things a phone does better than paper — it checks each word actually **traces on the board**
and **cancels duplicates** — but whether a word is a *real* word is left to the players, exactly like the tabletop
challenge. When time runs out the lists are compared: words found by **both players are struck out**, and the rest
score by length (**3–4 → 1, 5 → 2, 6 → 3, 7 → 5, 8+ → 11**). Highest total wins.

Each player's list stays on their own device during play and submits only when the clock hits zero — the two
submissions are sequenced (host first) so the writes never race. The board itself is shared, revealed to both only
once both tap **Via!**.

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
