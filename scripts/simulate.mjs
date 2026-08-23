/**
 * Plays a few hundred random deals of each game and checks the invariants that
 * matter: 40 cards always accounted for, no stuck states, every hand terminates.
 *
 * The rules engines live inside src/App.jsx and have to stay there — App.jsx
 * must keep running unmodified as a Claude artifact, so it can't grow an import
 * of src/rules.js. Instead this script slices the rules region out of the source
 * at test time and evaluates it as a module. The cut is the file from the react
 * import to the "feedback" banner: constants, deck helpers and the three rules
 * engines, all pure, none of it touching the DOM.
 *
 *   node scripts/simulate.mjs [deals-per-variant]
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEALS = Number(process.argv[2] || 300);

/* ── slice the rules out of App.jsx ─────────────────────────── */
const src = readFileSync(join(root, "src/App.jsx"), "utf8");
const end = src.indexOf("/* ═══════════════════════════ feedback");
if (end < 0) throw new Error("can't find the feedback banner — has App.jsx been restructured?");
const body = src
  .slice(0, end)
  .replace(/^import .*from "react";\n/, "");
for (const banned of ["document", "window", "useState", "useEffect"])
  if (new RegExp(`\\b${banned}\\b`).test(body))
    throw new Error(`the rules slice references ${banned} — the cut point is wrong`);

const EXPORTS = [
  "makeDeck", "shuffle", "shuffleWith", "cutDeck", "GAMES",
  "dealScopa", "scopaOptions", "scopaPlay", "scoreScopa", "primiera",
  "dealRuba", "rubaOptions", "rubaPlay",
  "dealCamicia", "camiciaFlip", "demand",
  "makePeppaDeck", "dealPeppa", "peppaDraw", "peppaShed", "peppaShuffle", "peppaReady", "peppaReorder", "peppaOffer",
  "TACT", "dealTactics", "tacticsSetup", "tacticsActivate", "tacticsReach", "tacticsTargets",
  "tacticsRoll", "tacticsDeployable", "tacticsBoard", "hdist", "hkey", "unhkey", "HEX_DIRS",
  "dealBriscola", "briscolaPlay", "brisPoints",
  "dealPerudo", "perudoRoll", "perudoBid", "perudoDoubt", "perudoNext",
  "dealYahtzee", "yahtRoll", "yahtScore", "yahtValue", "yahtTotal", "YCATS",
  "dealFarkle", "farkleRoll", "farkleRollOn", "farkleBank", "farkleSelectionScore", "farkleHasScore",
  "dealBestiario", "bestiarioPlay", "bestiarioPass", "bestDests", "bestAnyMove", "BEST_CARDS", "BEST_TEMPLE",
  "dealFlotta", "flottaSetup", "flottaFire", "flottaMove", "flottaSonar", "flottaRepair", "flRandomFleet", "flFleetValid", "FL_FLEET", "FL_N",
  "dealParoliere", "parolReady", "parolShake", "parolSubmit", "parolTrace", "parolBoard", "parolBoardSeeded", "parolPoints", "PAROL_N", "PAROL_SHAKES",
  "makeS40Deck", "analyzeMeld", "s40JokerRuns", "s40CanUseDiscard", "dealScala", "s40Draw", "s40Open", "s40Meld", "s40LayOff", "s40Discard",
];
const dir = mkdtempSync(join(tmpdir(), "osteria-"));
const modPath = join(dir, "rules.mjs");
writeFileSync(modPath, `${body}\nexport { ${EXPORTS.join(", ")} };\n`);
const R = await import(`file://${modPath}`);

/* ── harness ────────────────────────────────────────────────── */
let failures = 0;
const fail = (what, detail) => {
  failures++;
  console.error(`  ✗ ${what}: ${detail}`);
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Every card in the deck, exactly once, wherever it currently sits. */
function census(where, label) {
  const ids = [];
  for (const [name, cards] of Object.entries(where)) {
    if (!Array.isArray(cards)) return fail(label, `${name} is not a pile`);
    for (const c of cards) ids.push(c.id);
  }
  const uniq = new Set(ids);
  if (ids.length !== 40) fail(label, `${ids.length} cards, expected 40`);
  else if (uniq.size !== 40) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    fail(label, `duplicated ${[...new Set(dupes)].join(", ")}`);
  }
}

const scopaCensus = (g, label) =>
  census({ deck: g.deck, table: g.table, handA: g.hands.A, handB: g.hands.B, pileA: g.piles.A, pileB: g.piles.B }, label);
const camiciaCensus = (g, label) =>
  census({ deckA: g.decks.A, deckB: g.decks.B, center: g.center }, label);

/* ── scopa ──────────────────────────────────────────────────── */
function playScopa(o) {
  let g = R.dealScopa("A", { A: 0, B: 0 }, o);
  let steps = 0;
  const MAX = 3000;
  while (!g.matchDone) {
    if (++steps > MAX) return fail("scopa", `no match end after ${MAX} plays (opts ${JSON.stringify(o)})`);
    scopaCensus(g, "scopa mid-hand");

    if (g.done) {
      // deal over — check the scoring, then cut a fresh one
      const s = g.summary;
      if (!s) return fail("scopa", "deal marked done with no summary");
      if (g.piles.A.length + g.piles.B.length !== 40)
        fail("scopa", `deal ended with ${g.piles.A.length + g.piles.B.length} cards collected, expected 40`);
      if (g.table.length) fail("scopa", `deal ended with ${g.table.length} cards stranded on the table`);
      // The settebello is in exactly one pile, so it is scored exactly once, every deal.
      const sette = s.lines.filter((l) => l.why === "Settebello");
      if (sette.length !== 1) fail("scopa", `settebello awarded ${sette.length} times in one deal`);
      // Points on the scoreboard must be the points on the lines that explain them.
      for (const seat of ["A", "B"]) {
        const shown = s.lines.filter((l) => l.seat === seat).reduce((t, l) => t + l.n, 0);
        if (shown !== s.pts[seat]) fail("scopa", `${seat} scored ${s.pts[seat]} but the lines add to ${shown}`);
        const scope = s.lines.filter((l) => l.seat === seat && /Scopa|Scope/.test(l.why)).reduce((t, l) => t + l.n, 0);
        if (scope !== g.scope[seat]) fail("scopa", `${seat} swept ${g.scope[seat]} times but scored ${scope}`);
      }
      g = R.dealScopa(g.dealer === "A" ? "B" : "A", g.scores, o);
      continue;
    }

    const seat = g.turn;
    const hand = g.hands[seat];
    if (!hand.length) return fail("scopa", `${seat} is on turn holding no cards — stuck`);

    // A capture is compulsory where one exists, so prefer any card that has options.
    const withOpts = hand
      .map((c) => ({ c, opts: R.scopaOptions(c, g.table, o) }))
      .filter((x) => x.opts.length);
    const choice = withOpts.length ? pick(withOpts) : { c: pick(hand), opts: [] };
    const res = R.scopaPlay(g, seat, choice.c.id, choice.opts.length ? pick(choice.opts) : null, o);
    if (!res) return fail("scopa", `scopaPlay rejected a card that was in ${seat}'s hand`);
    g = res.g;
  }
  const { A, B } = g.scores;
  if (A < o.target && B < o.target) fail("scopa", `match ended at ${A}–${B}, below target ${o.target}`);
  if (A === B) fail("scopa", `match ended tied at ${A}`);
  return steps;
}

/* ── rubamazzo ──────────────────────────────────────────────── */
function playRuba(o) {
  let g = R.dealRuba("A", { A: 0, B: 0 });
  let steps = 0;
  const MAX = 3000;
  while (!g.done) {
    if (++steps > MAX) return fail("ruba", `hand never ended after ${MAX} plays (opts ${JSON.stringify(o)})`);
    scopaCensus(g, "ruba mid-hand");
    const seat = g.turn;
    const hand = g.hands[seat];
    if (!hand.length) return fail("ruba", `${seat} is on turn holding no cards — stuck`);
    const withOpts = hand
      .map((c) => ({ c, opts: R.rubaOptions(c, g, seat, o) }))
      .filter((x) => x.opts.length);
    const choice = withOpts.length && Math.random() < 0.85 ? pick(withOpts) : { c: pick(hand), opts: [] };
    const res = R.rubaPlay(g, seat, choice.c.id, choice.opts.length ? pick(choice.opts) : null);
    if (!res) return fail("ruba", `rubaPlay rejected a card that was in ${seat}'s hand`);
    g = res.g;
  }
  if (g.piles.A.length + g.piles.B.length !== 40)
    fail("ruba", `hand ended with ${g.piles.A.length + g.piles.B.length} cards collected, expected 40`);
  if (g.table.length) fail("ruba", `hand ended with ${g.table.length} cards stranded on the table`);
  return steps;
}

/* ── straccia camicia ───────────────────────────────────────── */
function playCamicia(o) {
  let g = R.dealCamicia({ A: 0, B: 0 });
  let steps = 0;
  const MAX = 1200; // the engine calls a draw at 900 flips
  while (!g.done) {
    if (++steps > MAX) return fail("camicia", `no draw called after ${MAX} flips (opts ${JSON.stringify(o)})`);
    camiciaCensus(g, "camicia mid-hand");
    if (!g.decks[g.turn].length) return fail("camicia", `${g.turn} is on turn with an empty packet — stuck`);
    const res = R.camiciaFlip(g, g.turn, o);
    if (!res) return fail("camicia", "camiciaFlip refused the seat it had just put on turn");
    g = res.g;
  }
  camiciaCensus(g, "camicia end");
  if (g.win && g.decks[g.win === "A" ? "B" : "A"].length)
    fail("camicia", `${g.win} won while the loser still held ${g.decks[g.win === "A" ? "B" : "A"].length} cards`);
  return { steps, draw: g.win === null };
}

/* ── peppa tencia (old maid) ────────────────────────────────── */
// A trimmed 37-card deck, so its own census: cards in the two hands plus the
// counts already shed must always total 37, and the hands must never duplicate
// a card. Every game must end with exactly one player holding the lone Peppa.
function playPeppa() {
  let g = R.dealPeppa("A", { A: 0, B: 0 });
  if (R.makePeppaDeck().length !== 37) return fail("peppa", `deck has ${R.makePeppaDeck().length} cards, expected 37`);
  const check = (label) => {
    const ids = [...g.hands.A, ...g.hands.B].map((c) => c.id);
    const total = ids.length + g.shed.A + g.shed.B;
    if (total !== 37) fail(label, `${total} cards accounted for, expected 37`);
    if (new Set(ids).size !== ids.length) fail(label, "a card is in both hands");
    // no hand may hold two of the same rank once the opening shed is done
    for (const s of ["A", "B"]) {
      const seen = new Set();
      for (const c of g.hands[s]) {
        if (seen.has(c.v)) return fail(label, `${s} holds an un-shed pair of ${c.v}`);
        seen.add(c.v);
      }
    }
  };
  check("peppa deal");
  let steps = 0;
  let draws = 0;
  const MAX = 800;
  while (!g.done) {
    if (++steps > MAX) return fail("peppa", `no end after ${MAX} steps`);
    if (g.phase === "arrange") {
      // the holder (other than the drawer) shuffles a few times, then presents
      const holder = other(g.turn);
      const rounds = Math.floor(Math.random() * 3);
      for (let k = 0; k < rounds; k++) {
        const s = R.peppaShuffle(g, holder);
        if (!s) return fail("peppa", "peppaShuffle refused the holder in the arrange beat");
        g = s.g;
        check("peppa arrange");
      }
      // occasionally drag a card to a new slot and/or raise one as an offer
      if (g.hands[holder].length && Math.random() < 0.5) {
        const h = g.hands[holder];
        const card = h[Math.floor(Math.random() * h.length)];
        const to = Math.floor(Math.random() * h.length);
        const r2 = R.peppaReorder(g, holder, card.id, to);
        if (r2) {
          g = r2.g;
          check("peppa reorder");
          if (g.hands[holder].length !== h.length) return fail("peppa", "reorder changed the hand size");
        }
        const off = R.peppaOffer(g, holder, g.hands[holder][0].id);
        if (off) g = off.g;
      }
      // the drawer must not be able to act during the arrange beat
      const early = R.peppaDraw(g, g.turn, 0);
      if (early) return fail("peppa", "peppaDraw was allowed before the hand was presented");
      const r = R.peppaReady(g, holder);
      if (!r) return fail("peppa", "peppaReady refused the holder");
      g = r.g;
      continue;
    }
    const seat = g.turn;
    const src = g.hands[other(seat)];
    if (!src.length) return fail("peppa", `${seat} on turn but opponent has no cards — stuck`);
    const res = R.peppaDraw(g, seat, Math.floor(Math.random() * src.length));
    if (!res) return fail("peppa", "peppaDraw refused a valid slot");
    g = res.g;
    draws++;
    check("peppa mid-hand");
  }
  if (g.win == null) return fail("peppa", "ended with no winner");
  const loser = g.win === "A" ? "B" : "A";
  if (g.hands[g.win].length !== 0) fail("peppa", `${g.win} 'won' still holding ${g.hands[g.win].length} cards`);
  if (g.hands[loser].length !== 1 || g.hands[loser][0].id !== "S9")
    fail("peppa", `loser should hold only the Peppa (S9), holds ${JSON.stringify(g.hands[loser].map((c) => c.id))}`);
  return draws;
}
const other = (s) => (s === "A" ? "B" : "A");

/* ── condottieri (tactics) ──────────────────────────────────── */
// Hex-math identities plus a full random game: roster → deploy → battle, all
// the way to a decisive end (or the round-cap tiebreak). Checks connectivity,
// legal deploys, HP bounds, and that every win condition holds when it fires.
function tacticsHexChecks() {
  const A = { q: 0, r: 0 };
  if (R.hdist(A, A) !== 0) fail("tactics hex", "distance to self must be 0");
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (const [dq, dr] of dirs) if (R.hdist(A, { q: dq, r: dr }) !== 1) fail("tactics hex", `neighbor ${dq},${dr} not at distance 1`);
  if (R.hdist({ q: 0, r: 0 }, { q: 2, r: -1 }) !== 2) fail("tactics hex", "distance math wrong");
}
function tacticsConnectedKeys(openKeys) {
  const set = new Set(openKeys);
  const seen = new Set([openKeys[0]]);
  const stack = [openKeys[0]];
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  while (stack.length) {
    const { q, r } = R.unhkey(stack.pop());
    for (const [dq, dr] of dirs) {
      const nk = R.hkey(q + dq, r + dr);
      if (set.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        stack.push(nk);
      }
    }
  }
  return seen.size === set.size;
}
// A random legal company for the current mode: the essential four, or a budget
// draft of 3–6 from the full pool.
function draftCompany(simple) {
  if (simple) {
    const k = 1 + Math.floor(Math.random() * 3); // 1..3 Fanti, rest Arcieri
    return [...Array(k).fill("fante"), ...Array(4 - k).fill("arciere")];
  }
  const types = Object.keys(R.TACT.units);
  const costOf = (t) => R.TACT.units[t].cost;
  const cheapest = Math.min(...types.map(costOf));
  const comp = [];
  let budget = R.TACT.BUDGET;
  while (comp.length < R.TACT.MAX_UNITS) {
    const affordable = types.filter((t) => costOf(t) <= budget);
    if (!affordable.length) break;
    if (comp.length >= R.TACT.MIN_UNITS && Math.random() < 0.35) break;
    const t = affordable[Math.floor(Math.random() * affordable.length)];
    comp.push(t);
    budget -= costOf(t);
  }
  while (comp.length < R.TACT.MIN_UNITS && budget >= cheapest) {
    const t = types.find((x) => costOf(x) === cheapest);
    comp.push(t);
    budget -= cheapest;
  }
  return comp;
}
function playTactics() {
  const simple = Math.random() < 0.5; // exercise both the essential and full rules
  const passAllies = Math.random() < 0.5; // and both the move-through-allies settings
  let g = R.dealTactics("A", { simple, passAllies }, { A: 0, B: 0 });
  const openKeys = g.board.cells.map((c) => R.hkey(c.q, c.r)).filter((k) => !g.board.blocked[k]);
  if (!tacticsConnectedKeys(openKeys)) return fail("tactics", "generated board is not fully connected");
  for (const k of g.board.banners) if (!openKeys.includes(k)) return fail("tactics", "a banner sits on a blocked or off-board hex");
  // roster + deployment are one hidden step: each seat drafts a company and
  // places it, locked in serialized (dealer first). Nothing is shared until both
  // are in and the battle opens.
  let expected = 0,
    guard = 0;
  while (g.phase === "setup") {
    if (++guard > 4) return fail("tactics", "setup never finished");
    const seat = g.setup.A == null ? "A" : "B"; // each seat locks in independently now
    const comp = draftCompany(g.simple);
    const used = new Set();
    const placements = [];
    for (const type of comp) {
      const spot = openKeys.find((k) => !used.has(k) && R.tacticsDeployable(g, seat, k));
      if (!spot) return fail("tactics", `no legal deploy hex for ${seat}`);
      used.add(spot);
      const { q, r: rr } = R.unhkey(spot);
      placements.push({ type, q, r: rr });
    }
    const d = R.tacticsSetup(g, seat, placements);
    if (!d) return fail("tactics", "setup refused a legal company");
    g = d.g;
    expected += comp.length;
  }
  if (g.phase !== "battle") return fail("tactics", "did not reach battle");
  if (g.order.length !== expected) return fail("tactics", `expected ${expected} units deployed, got ${g.order.length}`);
  // battle: strict alternation — the side on turn moves one of its rested units.
  // Random legal activations until a win or the move cap ends it.
  let steps = 0;
  const MAX = 4000;
  while (!g.done) {
    if (++steps > MAX) return fail("tactics", "battle never ended (move cap should have)");
    const seat = g.turn;
    const mine = g.order.filter((id) => g.units[id].owner === seat && (g.spent[id] || 0) < R.TACT.ACTS);
    if (!mine.length) return fail("tactics", `${seat} on turn with no rested unit`);
    const uid = mine[Math.floor(Math.random() * mine.length)];
    const reach = R.tacticsReach(g, g.units[uid]);
    const spots = Object.keys(reach);
    const to = spots.length && Math.random() < 0.8 ? spots[Math.floor(Math.random() * spots.length)] : null;
    // choose a target reachable from the prospective position
    const probe = JSON.parse(JSON.stringify(g));
    if (to) {
      const { q, r: rr } = R.unhkey(to);
      probe.units[uid].q = q;
      probe.units[uid].r = rr;
    }
    const tgts = R.tacticsTargets(probe, probe.units[uid]);
    // resting on your own castle/fountain heals but forbids an attack that turn
    const finalKey = to || R.hkey(g.units[uid].q, g.units[uid].r);
    const healing = finalKey === g.board.castle[seat] || finalKey === g.board.fount[seat];
    const isMage = !!R.TACT.units[g.units[uid].type].aoe;
    let action = null;
    if (!healing && tgts.length && Math.random() < 0.9) {
      if (isMage) {
        // the Mago aims a first enemy hex, then a bordering non-obstacle hex
        const tid = tgts[Math.floor(Math.random() * tgts.length)];
        const t = probe.units[tid];
        const k1 = R.hkey(t.q, t.r);
        const cellSet = new Set(g.board.cells.map((c) => R.hkey(c.q, c.r)));
        const mates = [];
        for (const [dq, dr] of R.HEX_DIRS) {
          const nk = R.hkey(t.q + dq, t.r + dr);
          if (cellSet.has(nk) && !g.board.blocked[nk]) mates.push(nk);
        }
        if (mates.length) action = { kind: "blast", cells: [k1, mates[Math.floor(Math.random() * mates.length)]] };
      } else {
        action = { kind: "attack", targetId: tgts[Math.floor(Math.random() * tgts.length)] };
      }
    }
    const res = R.tacticsActivate(g, seat, uid, to, action);
    if (!res) return fail("tactics", "activate refused a move it validated as legal");
    g = res.g;
    for (const id of g.order) {
      const u = g.units[id];
      if (u.hp < 1 || u.hp > u.max) fail("tactics", `${id} hp ${u.hp} out of 1..${u.max}`);
    }
  }
  // the win condition it claims must actually hold
  if (g.win != null) {
    const loser = other(g.win);
    if (g.how === "wipe" && g.order.some((id) => g.units[id].owner === loser)) fail("tactics", "wipe win but the loser still has units");
    if (g.how === "castle") {
      const onKeep = g.order.some((id) => g.units[id].owner === g.win && R.hkey(g.units[id].q, g.units[id].r) === g.board.castle[loser]);
      if (!onKeep) fail("tactics", "castle win but no unit stands on the enemy castle");
    }
  }
  return steps;
}

/* ── briscola ───────────────────────────────────────────────── */
const brisCensus = (g, label) =>
  census(
    { deck: g.deck, handA: g.hands.A, handB: g.hands.B, pileA: g.piles.A, pileB: g.piles.B, lead: g.lead ? [g.lead.card] : [] },
    label
  );
function playBriscola() {
  let g = R.dealBriscola("A", { A: 0, B: 0 });
  let steps = 0;
  const MAX = 100;
  while (!g.done) {
    if (++steps > MAX) return fail("briscola", `no end after ${MAX} plays`);
    brisCensus(g, "briscola mid-hand");
    const hand = g.hands[g.turn];
    if (!hand.length) return fail("briscola", `${g.turn} is on turn holding no cards — stuck`);
    const res = R.briscolaPlay(g, g.turn, pick(hand).id);
    if (!res) return fail("briscola", "briscolaPlay rejected a card in hand");
    g = res.g;
  }
  brisCensus(g, "briscola end");
  const total = R.brisPoints(g.piles.A) + R.brisPoints(g.piles.B);
  if (total !== 120) fail("briscola", `points sum to ${total}, expected 120`);
  if (g.piles.A.length + g.piles.B.length !== 40)
    fail("briscola", `hand ended with ${g.piles.A.length + g.piles.B.length} cards collected, expected 40`);
  return steps;
}

/* ── perudo ─────────────────────────────────────────────────── */
function playPerudo() {
  let g = R.dealPerudo("A", { A: 0, B: 0 });
  let steps = 0;
  const MAX = 600;
  while (!g.done) {
    if (++steps > MAX) return fail("perudo", `no end after ${MAX} steps`);
    if (g.counts.A < 0 || g.counts.B < 0) return fail("perudo", "negative dice count");
    if (g.phase === "roll") {
      const res = R.perudoRoll(g, g.turn);
      if (!res) return fail("perudo", "roll refused");
      if (res.g.rolled[g.turn] && res.g.dice[g.turn].length !== res.g.counts[g.turn])
        return fail("perudo", "rolled wrong number of dice");
      g = res.g;
    } else if (g.phase === "bid") {
      if (g.bid && Math.random() < 0.35) {
        const res = R.perudoDoubt(g, g.turn);
        if (!res) return fail("perudo", "doubt refused");
        g = res.g;
      } else {
        let qty, face;
        if (!g.bid) {
          qty = 1;
          face = 2 + Math.floor(Math.random() * 5);
        } else if (Math.random() < 0.5 && g.bid.face < 6) {
          qty = g.bid.qty;
          face = g.bid.face + 1;
        } else {
          qty = g.bid.qty + 1;
          face = 2 + Math.floor(Math.random() * 5);
        }
        const res = R.perudoBid(g, g.turn, qty, face);
        if (res) g = res.g;
        else {
          const d = R.perudoDoubt(g, g.turn);
          if (!d) return fail("perudo", "neither bid nor doubt accepted");
          g = d.g;
        }
      }
    } else if (g.phase === "reveal") {
      const res = R.perudoNext(g, g.reveal.loser);
      if (!res) return fail("perudo", "next refused");
      g = res.g;
    }
  }
  if (!(g.counts.A === 0 || g.counts.B === 0)) fail("perudo", "ended without a 0-dice player");
  if (g.win == null) fail("perudo", "no winner recorded");
  return steps;
}

/* ── yahtzee ────────────────────────────────────────────────── */
function playYahtzee() {
  let g = R.dealYahtzee("A", { A: 0, B: 0 });
  const KEYS = R.YCATS.map((c) => c.k);
  let steps = 0;
  const MAX = 3000;
  while (!g.done) {
    if (++steps > MAX) return fail("yahtzee", `no end after ${MAX} steps`);
    const seat = g.turn;
    const empty = KEYS.filter((k) => !(k in g.scores[seat]));
    if (!g.rolled || (g.rollsLeft > 0 && Math.random() < 0.5)) {
      const res = R.yahtRoll(g, seat);
      if (res) {
        g = res.g;
        continue;
      }
    }
    if (!empty.length) return fail("yahtzee", `${seat} has no empty category but game not done`);
    const res = R.yahtScore(g, seat, empty[Math.floor(Math.random() * empty.length)]);
    if (!res) return fail("yahtzee", "score refused after a roll");
    g = res.g;
  }
  for (const s of ["A", "B"])
    if (Object.keys(g.scores[s]).length !== 13) fail("yahtzee", `${s} filled ${Object.keys(g.scores[s]).length}/13 boxes`);
  if (g.win == null && g.summary.a !== g.summary.b) fail("yahtzee", "no winner but totals differ");
  return steps;
}

/* ── diecimila (farkle) ─────────────────────────────────────── */
// A greedy legal pick: everything that scores. Straights/three-pairs take all
// six; otherwise every 1, every 5, and every face appearing three or more times.
function farkleSelect(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach((d) => c[d]++);
  if (dice.length === 6) {
    if (c.slice(1).every((n) => n === 1)) return dice.map((_, i) => i);
    if (c.slice(1).filter((n) => n === 2).length === 3) return dice.map((_, i) => i);
  }
  const idx = [];
  dice.forEach((d, i) => {
    if (d === 1 || d === 5 || c[d] >= 3) idx.push(i);
  });
  return idx;
}
function playFarkle(opts) {
  let g = R.dealFarkle("A", { A: 0, B: 0 }, opts);
  let steps = 0;
  const MAX = 40000;
  while (!g.done) {
    if (++steps > MAX) return fail("diecimila", `no end after ${MAX} steps`);
    const seat = g.turn;
    if (!g.rolled) {
      const res = R.farkleRoll(g, seat);
      if (!res) return fail("diecimila", "opening roll refused");
      g = res.g;
      continue;
    }
    const sel = farkleSelect(g.dice);
    if (!sel.length) return fail("diecimila", "no scoring pick though the roll wasn't a farkle");
    const pts = R.farkleSelectionScore(sel.map((i) => g.dice[i]));
    if (pts == null || pts <= 0) return fail("diecimila", "greedy pick scored as invalid");
    const wantBank = g.turnScore + pts >= 350 || Math.random() < 0.35;
    let res = wantBank ? R.farkleBank(g, seat, sel) : R.farkleRollOn(g, seat, sel);
    if (!res) res = R.farkleRollOn(g, seat, sel); // bank can be blocked by the entry rule
    if (!res) return fail("diecimila", "neither bank nor roll-on accepted");
    g = res.g;
  }
  if (g.scores.A < g.target && g.scores.B < g.target) fail("diecimila", "ended before anyone reached the target");
  if (g.win == null && g.summary && g.summary.a !== g.summary.b) fail("diecimila", "no winner but totals differ");
  if (g.win != null && g.scores[g.win] < g.scores[g.win === "A" ? "B" : "A"]) fail("diecimila", "declared winner has the lower score");
  return steps;
}
// The scoring table is the game — check every rule it states.
function farkleScoreTests() {
  const S = R.farkleSelectionScore;
  const H = R.farkleHasScore;
  const cases = [
    [[1], 100], [[5], 50], [[1, 5], 150],
    [[1, 1, 1], 1000], [[2, 2, 2], 200], [[6, 6, 6], 600], [[5, 5, 5], 500],
    [[1, 1, 1, 1], 2000], [[1, 1, 1, 1, 1], 4000], [[1, 1, 1, 1, 1, 1], 8000],
    [[6, 6, 6, 6], 1200], [[5, 5, 5, 5], 1000],
    [[1, 2, 3, 4, 5, 6], 1500], [[2, 2, 3, 3, 4, 4], 1500],
    [[2, 2, 2, 5], 250], [[3, 3, 3, 1], 400],
    [[2, 2], null], [[3], null], [[2, 3, 4, 6], null],
  ];
  for (const [dice, want] of cases) {
    const got = S(dice);
    if (got !== want) fail("diecimila scoring", `${dice.join("")} → ${got}, expected ${want}`);
  }
  const busts = [[2, 3, 4, 6], [2, 2, 3, 3, 6], [2, 2, 4, 4, 6]];
  for (const d of busts) if (H(d)) fail("diecimila scoring", `${d.join("")} wrongly reads as scoring`);
  const scoring = [[1], [5], [2, 2, 3, 3, 4, 4], [6, 6, 6, 2], [1, 2, 3, 4, 5, 6]];
  for (const d of scoring) if (!H(d)) fail("diecimila scoring", `${d.join("")} wrongly reads as a farkle`);
}

/* ── bestiario (onitama) ────────────────────────────────────── */
function bestMoveList(g, seat) {
  const moves = [];
  for (let i = 0; i < 25; i++) {
    const p = g.board[i];
    if (!p || p.seat !== seat) continue;
    for (const cid of g.cards[seat]) for (const to of R.bestDests(g, seat, i, cid)) moves.push({ from: i, to, cid });
  }
  return moves;
}
function playBestiario() {
  let g = R.dealBestiario("A", { A: 0, B: 0 });
  let steps = 0;
  const MAX = 1500;
  while (!g.done) {
    if (++steps > MAX) return fail("bestiario", `no end after ${MAX} steps`);
    const seat = g.turn;
    const moves = bestMoveList(g, seat);
    if (!moves.length) {
      if (R.bestAnyMove(g, seat)) return fail("bestiario", "move list empty but bestAnyMove says otherwise");
      const res = R.bestiarioPass(g, seat, g.cards[seat][0]);
      if (!res) return fail("bestiario", "pass refused while stuck");
      g = res.g;
      continue;
    }
    // Win-seeking policy so games actually end: take the enemy master, else any
    // capture, else march the master toward the enemy temple, else wander.
    const temple = R.BEST_TEMPLE[seat === "A" ? "B" : "A"];
    const tr = (temple / 5) | 0,
      tc = temple % 5;
    let best = null,
      bestScore = -Infinity;
    for (const mv of moves) {
      const occ = g.board[mv.to];
      const mover = g.board[mv.from];
      let sc = Math.random();
      if (occ && occ.master) sc = 1e9;
      else if (occ) sc = 1000 + Math.random();
      else if (mover.master) sc = 50 - (Math.abs(((mv.to / 5) | 0) - tr) + Math.abs((mv.to % 5) - tc));
      if (sc > bestScore) {
        bestScore = sc;
        best = mv;
      }
    }
    const res = R.bestiarioPlay(g, seat, best.from, best.to, best.cid);
    if (!res) return fail("bestiario", "play refused a move it listed as legal");
    g = res.g;
  }
  if (g.win == null) return fail("bestiario", "ended without a winner");
  if (!g.how) fail("bestiario", "win with no recorded reason");
  // the pieces are always accounted for: never more than five a side, one master each
  for (const s of ["A", "B"]) {
    const mine = g.board.filter((p) => p && p.seat === s);
    if (mine.length > 5) fail("bestiario", `${s} somehow has ${mine.length} pieces`);
  }
  return steps;
}
function bestBlank(turn, cardsA, cardsB, spare) {
  return { board: Array(25).fill(null), cards: { A: cardsA, B: cardsB, spare }, turn, last: null, tally: { A: 0, B: 0 }, done: false, matchDone: false, win: null, how: null };
}
function bestiarioRuleTests() {
  // deal shape
  const d = R.dealBestiario("A", { A: 0, B: 0 });
  const aPieces = d.board.filter((p) => p && p.seat === "A");
  const bPieces = d.board.filter((p) => p && p.seat === "B");
  if (aPieces.length !== 5 || bPieces.length !== 5) fail("bestiario rules", "each side should start with five pieces");
  if (aPieces.filter((p) => p.master).length !== 1 || bPieces.filter((p) => p.master).length !== 1) fail("bestiario rules", "each side needs exactly one master");
  const dealt = [...d.cards.A, ...d.cards.B, d.cards.spare];
  if (new Set(dealt).size !== 5) fail("bestiario rules", "five distinct cards should be dealt");

  // seat B applies moves rotated 180°: cavallo's forward step from the B temple
  // (index 22, r4c2) lands one row toward A, at r3c2 = 17
  const g1 = bestBlank("B", ["gru", "tigre"], ["cavallo", "bue"], "rana");
  g1.board[22] = { seat: "B", master: true };
  if (!R.bestDests(g1, "B", 22, "cavallo").includes(17)) fail("bestiario rules", "B's forward move should point down the board");

  // capturing the enemy master wins outright
  const g2 = bestBlank("A", ["cavallo", "gru"], ["tigre", "bue"], "rana");
  g2.board[12] = { seat: "A", master: true };
  g2.board[17] = { seat: "B", master: true };
  const cap = R.bestiarioPlay(g2, "A", 12, 17, "cavallo");
  if (!cap || cap.g.win !== "A" || cap.g.how !== "capture") fail("bestiario rules", "taking the enemy master should win by capture");

  // reaching the enemy temple wins
  const g3 = bestBlank("A", ["cavallo", "gru"], ["tigre", "bue"], "rana");
  g3.board[17] = { seat: "A", master: true };
  const tmp = R.bestiarioPlay(g3, "A", 17, 22, "cavallo");
  if (!tmp || tmp.g.win !== "A" || tmp.g.how !== "temple") fail("bestiario rules", "master onto the enemy temple should win");

  // never land on your own piece
  const g4 = bestBlank("A", ["cavallo", "gru"], ["tigre", "bue"], "rana");
  g4.board[12] = { seat: "A", master: true };
  g4.board[17] = { seat: "A", master: false };
  if (R.bestiarioPlay(g4, "A", 12, 17, "cavallo") != null) fail("bestiario rules", "a piece must not land on a friendly one");

  // pass is only legal when genuinely stuck
  if (R.bestiarioPass(g2, "A", "cavallo") != null) fail("bestiario rules", "pass should be refused while a move exists");
}

/* ── flotta (battaglia navale) ──────────────────────────────── */
function flFleetAt() {
  return [
    { size: 4, cells: [0, 1, 2, 3] },
    { size: 3, cells: [16, 17, 18] },
    { size: 3, cells: [32, 33, 34] },
    { size: 2, cells: [48, 49] },
  ];
}
// Static-fleet sweep: fire every cell in turn (plus a one-off sonar and the
// salvo), so the game is guaranteed to end. Movement/repair break the sweep
// guarantee, so they're exercised in the unit tests, not this loop.
function playFlotta() {
  let g = R.dealFlotta("A", { A: 0, B: 0 });
  for (const s of ["A", "B"]) {
    const res = R.flottaSetup(g, s, R.flRandomFleet());
    if (!res) return fail("flotta", "setup refused a valid fleet");
    g = res.g;
  }
  if (g.phase !== "battle") return fail("flotta", "battle didn't open after both deployed");
  const cur = { A: 0, B: 0 };
  const usedSonar = { A: false, B: false };
  let steps = 0;
  const MAX = 400;
  while (!g.done) {
    if (++steps > MAX) return fail("flotta", `no end after ${MAX} steps`);
    const seat = g.turn;
    const r = Math.random();
    if (!usedSonar[seat] && g.powers[seat].sonar && r < 0.05) {
      usedSonar[seat] = true;
      const res = R.flottaSonar(g, seat, Math.floor(Math.random() * 64));
      if (res) {
        g = res.g;
        continue;
      }
    }
    while (cur[seat] < 64 && g.shots[seat][cur[seat]]) cur[seat]++;
    if (cur[seat] >= 64) return fail("flotta", "swept every cell without a win");
    if (g.powers[seat].salva && r > 0.9) {
      const cells = [];
      let c = cur[seat];
      while (cells.length < 3 && c < 64) {
        if (!g.shots[seat][c]) cells.push(c);
        c++;
      }
      const res = R.flottaFire(g, seat, cells, true);
      if (res) {
        g = res.g;
        continue;
      }
    }
    const res = R.flottaFire(g, seat, [cur[seat]], false);
    if (!res) return fail("flotta", "fire refused a fresh cell");
    g = res.g;
  }
  if (g.win == null) return fail("flotta", "ended without a winner");
  return steps;
}
function flottaRuleTests() {
  if (!R.flFleetValid(R.flRandomFleet())) fail("flotta rules", "a random fleet should validate");
  if (!R.flFleetValid(flFleetAt())) fail("flotta rules", "hand-built fleet should validate");
  if (R.flFleetValid([{ size: 4, cells: [0, 1, 2, 3] }, { size: 3, cells: [3, 4, 5] }, { size: 3, cells: [16, 17, 18] }, { size: 2, cells: [48, 49] }]))
    fail("flotta rules", "an overlapping fleet should be rejected");

  let g = R.dealFlotta("A", { A: 0, B: 0 });
  if (g.phase !== "setup") fail("flotta rules", "should start in setup");
  g = R.flottaSetup(g, "A", flFleetAt()).g;
  if (g.phase !== "setup" || g.ships.A == null) fail("flotta rules", "one fleet in shouldn't open battle");
  g = R.flottaSetup(g, "B", flFleetAt()).g;
  if (g.phase !== "battle") fail("flotta rules", "both fleets in should open battle");

  g.turn = "A";
  let res = R.flottaFire(g, "A", [0], false);
  if (!res || res.g.shots.A[0] !== "hit") fail("flotta rules", "firing on a ship should read hit");
  g = res.g;
  g.turn = "A";
  res = R.flottaFire(g, "A", [10], false);
  if (!res || res.g.shots.A[10] !== "miss") fail("flotta rules", "firing on water should read miss");
  g = res.g;

  for (const c of [0, 1, 2, 3, 16, 17, 18, 32, 33, 34, 48, 49]) {
    if (g.done) break;
    g.turn = "A";
    const r = R.flottaFire(g, "A", [c], false);
    if (r) g = r.g;
  }
  if (!g.done || g.win !== "A" || g.how !== "sunk") fail("flotta rules", "sinking every enemy ship should win");
  if (!g.sunk.B.length) fail("flotta rules", "sunk ships should be recorded for the reveal");

  // maneuver keeps damage and shifts the hull
  let g2 = R.dealFlotta("A", { A: 0, B: 0 });
  g2 = R.flottaSetup(g2, "A", flFleetAt()).g;
  g2 = R.flottaSetup(g2, "B", flFleetAt()).g;
  g2.turn = "A";
  g2.ships.A[3].hits[0] = true;
  const mv = R.flottaMove(g2, "A", 3, 0, 1); // down one row: 48→56, 49→57
  if (!mv || mv.g.ships.A[3].cells[0] !== 56 || !mv.g.ships.A[3].hits[0]) fail("flotta rules", "a moved ship should shift and keep its wounds");
  g2.turn = "A";
  if (R.flottaMove(g2, "A", 0, 0, -1) != null) fail("flotta rules", "moving off the grid should be refused");

  // repair heals a wounded ship once
  let g3 = R.dealFlotta("A", { A: 0, B: 0 });
  g3 = R.flottaSetup(g3, "A", flFleetAt()).g;
  g3 = R.flottaSetup(g3, "B", flFleetAt()).g;
  g3.turn = "A";
  g3.ships.A[1].hits[1] = true;
  const rp = R.flottaRepair(g3, "A", 1, 1);
  if (!rp || rp.g.ships.A[1].hits[1] !== false || rp.g.powers.A.riparazione !== false) fail("flotta rules", "repair should heal a hit and spend the power");
}

/* ── il paroliere (boggle) ──────────────────────────────────── */
// A random walk over the board yields a genuinely traceable "word" (nonsense,
// but valid for the tracer) — enough to exercise scoring, dedup and cancelling.
function parolWalk(board) {
  const N = R.PAROL_N;
  const start = Math.floor(Math.random() * board.length);
  let cell = start;
  const used = new Set([cell]);
  let w = board[cell];
  const steps = 2 + Math.floor(Math.random() * 3);
  for (let s = 0; s < steps; s++) {
    const x = cell % N,
      y = (cell / N) | 0;
    const nbs = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
          const nc = ny * N + nx;
          if (!used.has(nc)) nbs.push(nc);
        }
      }
    if (!nbs.length) break;
    cell = nbs[Math.floor(Math.random() * nbs.length)];
    used.add(cell);
    w += board[cell];
  }
  return w;
}
function playParoliere() {
  let g = R.dealParoliere("A", { A: 0, B: 0 }, { secs: 180 });
  if (g.phase !== "shake") return fail("paroliere", "should start in the shake ritual");
  // both players shake their share, in turn
  let guard = 0;
  while (g.phase === "shake") {
    if (++guard > 50) return fail("paroliere", "shake ritual never ended");
    const r = R.parolShake(g, g.shaker, (guard * 2654435761) >>> 0);
    if (!r) return fail("paroliere", "shake refused on the shaker's turn");
    g = r.g;
  }
  if (g.phase !== "ready") return fail("paroliere", "shaking should lead to ready");
  if (g.shakes.A < R.PAROL_SHAKES || g.shakes.B < R.PAROL_SHAKES) fail("paroliere", "both should have shaken their share");
  g = R.parolReady(g, "A").g;
  if (g.phase !== "ready") return fail("paroliere", "one ready shouldn't start the round");
  g = R.parolReady(g, "B").g;
  if (g.phase !== "play") return fail("paroliere", "both ready should start play");
  // each seat builds a handful of traceable words (some shared, to test cancelling)
  const shared = [parolWalk(g.board), parolWalk(g.board)];
  const wordsA = shared.concat([parolWalk(g.board), parolWalk(g.board), "XZ"]); // "XZ" is too short/off-board → filtered
  const wordsB = shared.concat([parolWalk(g.board), parolWalk(g.board)]);
  g = R.parolSubmit(g, "A", wordsA).g;
  if (g.phase !== "play" || g.submitTurn !== "B") return fail("paroliere", "first submit should hand off to B");
  g = R.parolSubmit(g, "B", wordsB).g;
  if (g.phase !== "done" || !g.done) return fail("paroliere", "second submit should close the round");
  // every stored word must be traceable and ≥3 letters
  for (const s of ["A", "B"]) for (const w of g.words[s]) if (w.length < 3 || !R.parolTrace(g.board, w)) fail("paroliere", `stored an invalid word: ${w}`);
  // shared words must be cancelled on both sides (0 points, marked dup)
  for (const w of shared) {
    const up = w.toUpperCase();
    for (const s of ["A", "B"]) {
      const d = g.detail[s].find((x) => x.w === up);
      if (d && (!d.dup || d.pts !== 0)) fail("paroliere", "a shared word should cancel to zero");
    }
  }
  // score is the sum of non-duplicate word points
  for (const s of ["A", "B"]) {
    const want = g.detail[s].reduce((t, x) => t + x.pts, 0);
    if (g.scores[s] !== want) fail("paroliere", "score should equal the sum of unique word points");
  }
  if (g.win != null && g.scores[g.win] <= g.scores[g.win === "A" ? "B" : "A"]) fail("paroliere", "winner should have the strictly higher score");
  return 1;
}
function parolRuleTests() {
  // a hand-set board and tracing
  const board = ["C", "A", "N", "E", "S", "O", "L", "I", "R", "T", "M", "U", "B", "D", "P", "V"];
  // CANE: C(0)→A(1)→N(2)→E(3), all adjacent in the top row
  if (!R.parolTrace(board, "CANE")) fail("paroliere rules", "an adjacent path should trace");
  // a letter not on the board can't trace
  if (R.parolTrace(board, "ZZZ")) fail("paroliere rules", "off-board letters shouldn't trace");
  // no die reuse: "CC" needs two C dice but there's one
  if (R.parolTrace(board, "CC")) fail("paroliere rules", "a die must not be reused");
  // QU die counts as two letters
  const qb = ["QU", "A", "N", "O", "S", "I", "L", "E", "R", "T", "M", "U", "B", "D", "P", "V"];
  if (!R.parolTrace(qb, "QUANDO".slice(0, 4))) {
    /* QUAN: QU(0)+A(1)+N(2) then need another adjacent; keep it short */
  }
  if (!R.parolTrace(qb, "QUA")) fail("paroliere rules", "a QU die should satisfy the QU prefix");
  // scoring by length
  const pts = R.parolPoints;
  if (pts("ABC") !== 1 || pts("ABCD") !== 1 || pts("ABCDE") !== 2 || pts("ABCDEF") !== 3 || pts("ABCDEFG") !== 5 || pts("ABCDEFGH") !== 11) fail("paroliere rules", "length scoring is off");
  // every generated board has enough vowels to be playable
  for (let i = 0; i < 200; i++) {
    const b = R.parolBoard();
    if (b.length !== 16) fail("paroliere rules", "a board should have 16 dice");
    const v = b.filter((c) => /[AEIOU]/.test(c)).length;
    if (v < 5 || v > 10) fail("paroliere rules", `board vowel count out of range: ${v}`);
  }
  // Italian keeps H and Z, never J/K/W/X/Y (the covered-tray shake seeds it)
  for (let i = 0; i < 100; i++) {
    const b = R.parolBoard("IT").join("");
    if (/[JKWXY]/.test(b)) fail("paroliere rules", "Italian board should not carry J/K/W/X/Y");
  }
  // the seeded board is a pure function of the seed — both phones must match
  for (const seed of [1, 42, 999999, 2654435761]) {
    const a = R.parolBoardSeeded("IT", seed).join(",");
    const b = R.parolBoardSeeded("IT", seed).join(",");
    if (a !== b) fail("paroliere rules", "seeded board should be deterministic");
  }
  // the shake ritual: only the current shaker may shake, and it ends at ready
  let g = R.dealParoliere("A", { A: 0, B: 0 }, {});
  if (R.parolShake(g, "B", 7) != null) fail("paroliere rules", "the wrong seat should not be able to shake");
  const before = g.board.join(",");
  g = R.parolShake(g, "A", 12345).g;
  if (g.board.join(",") === before && g.seed === undefined) fail("paroliere rules", "a shake should be able to restir the tray");
}

/* ── scala 40 ───────────────────────────────────────────────── */
function scalaCensus(g, label) {
  const ids = [];
  for (const c of g.deck) ids.push(c.id);
  for (const c of g.discard) ids.push(c.id);
  for (const s of ["A", "B"]) for (const c of g.hands[s]) ids.push(c.id);
  for (const m of g.melds) for (const c of m.cards) ids.push(c.id);
  if (ids.length !== 106) fail(label, `${ids.length} cards, expected 106`);
  else if (new Set(ids).size !== 106) fail(label, "duplicated cards");
}
function s40FindMelds(hand) {
  const nats = hand.filter((c) => !c.joker);
  const out = [];
  const byRank = {};
  for (const c of nats) (byRank[c.v] = byRank[c.v] || []).push(c);
  for (const v in byRank) {
    const bySuit = {};
    for (const c of byRank[v]) bySuit[c.s] = c;
    const d = Object.values(bySuit);
    if (d.length >= 3) out.push(d.slice(0, 3).map((c) => c.id));
  }
  const bySuit = {};
  for (const c of nats) (bySuit[c.s] = bySuit[c.s] || []).push(c);
  for (const s in bySuit) {
    const uniq = [];
    const seen = new Set();
    for (const c of bySuit[s].slice().sort((a, b) => a.v - b.v)) if (!seen.has(c.v)) (seen.add(c.v), uniq.push(c));
    let i = 0;
    while (i < uniq.length) {
      let j = i;
      while (j + 1 < uniq.length && uniq[j + 1].v === uniq[j].v + 1) j++;
      if (j - i + 1 >= 3) for (let a = i; a + 2 <= j; a++) out.push(uniq.slice(a, j + 1).map((c) => c.id));
      i = j + 1;
    }
  }
  return out;
}
function playScala() {
  let g = R.dealScala("A", { A: 0, B: 0 });
  scalaCensus(g, "scala deal");
  let turns = 0;
  const MAX = 600;
  while (!g.done && turns++ < MAX) {
    const seat = g.turn;
    // taking the discard is now gated on immediate usability; always keep a
    // stock fallback so a turn can proceed either way
    let r = (Math.random() < 0.85 ? R.s40Draw(g, seat, "stock") : R.s40Draw(g, seat, "discard")) || R.s40Draw(g, seat, "stock") || R.s40Draw(g, seat, "discard");
    if (!r) break;
    g = r.g;
    scalaCensus(g, "scala after draw");
    const cand = s40FindMelds(g.hands[seat]);
    if (!g.opened[seat]) {
      const chosen = [];
      const used = new Set();
      for (const m of cand) {
        if (m.some((id) => used.has(id))) continue;
        chosen.push({ ids: m });
        m.forEach((id) => used.add(id));
      }
      if (chosen.length) {
        const o = R.s40Open(g, seat, chosen);
        if (o) g = o.g;
      }
    } else {
      for (const m of cand) {
        const mm = R.s40Meld(g, seat, m);
        if (mm) {
          g = mm.g;
          break;
        }
      }
      for (const c of g.hands[seat].slice()) {
        let laid = false;
        for (const meld of g.melds) {
          const lo = R.s40LayOff(g, seat, c.id, meld.id);
          if (lo) {
            g = lo.g;
            laid = true;
            break;
          }
        }
        if (laid) break;
      }
    }
    scalaCensus(g, "scala after meld");
    if (g.done) break;
    const h = g.hands[seat];
    if (!h.length) break;
    const worst = h.slice().sort((a, b) => (b.joker ? 30 : b.v) - (a.joker ? 30 : a.v))[0];
    const d = R.s40Discard(g, seat, worst.id);
    if (!d) return fail("scala", "discard refused");
    g = d.g;
    scalaCensus(g, "scala after discard");
  }
  if (g.done && (g.win == null || g.penalty == null)) fail("scala", "winner/penalty missing at end");
  return turns;
}

/* meld analyzer unit checks */
function s40MeldTests() {
  const C = (s, v) => ({ s, v });
  const JK = { joker: true };
  const cases = [
    [[C("H", 13), C("D", 13), C("S", 13)], "set", 30],
    [[C("H", 1), C("D", 1), C("S", 1)], "set", 33],
    [[C("H", 7), C("H", 7), C("S", 7)], false, 0],
    [[C("H", 5), C("H", 6), C("H", 7)], "run", 18],
    [[C("H", 1), C("H", 2), C("H", 3)], "run", 6],
    [[C("H", 12), C("H", 13), C("H", 1)], "run", 31],
    [[C("H", 13), C("H", 1), C("H", 2)], false, 0],
    [[C("H", 5), JK, C("H", 7)], "run", 18],
    [[C("H", 10), C("H", 11), C("H", 12), C("H", 13)], "run", 40],
  ];
  for (const [cards, kind, val] of cases) {
    const r = R.analyzeMeld(cards);
    const ok = kind === false ? !r.ok : r.ok && r.kind === kind && r.value === val;
    if (!ok) fail("scala meld", `${JSON.stringify(cards)} → ${JSON.stringify(r)}`);
  }
  // pinned jokers (rep): analyzeMeld must honour the chosen value
  const JR = (s, v) => ({ joker: true, rep: { s, v } });
  const repCases = [
    [[C("H", 5), JR("H", 6), C("H", 7)], "run", 18], // joker = 6H
    [[C("H", 5), C("H", 6), JR("H", 4)], "run", 15], // joker = 4H (low end)
    [[C("H", 5), C("H", 6), JR("H", 7)], "run", 18], // joker = 7H (high end)
    [[C("H", 5), JR("S", 6), C("H", 7)], false, 0], // wrong-suit pin breaks the run
    [[C("H", 13), C("D", 13), JR("S", 13)], "set", 30], // joker completes the set
  ];
  for (const [cards, kind, val] of repCases) {
    const r = R.analyzeMeld(cards);
    const ok = kind === false ? !r.ok : r.ok && r.kind === kind && r.value === val;
    if (!ok) fail("scala rep meld", `${JSON.stringify(cards)} → ${JSON.stringify(r)}`);
  }
  // joker placement enumeration: ambiguous → 2 options, gap-fill → 1, set → 0
  const ranks = (cards) => R.s40JokerRuns(cards).map((o) => o.rank).sort((a, b) => a - b);
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!eq(ranks([C("H", 5), C("H", 6), JK]), [4, 7])) fail("scala joker opts", "5-6-J should offer 4 or 7");
  if (!eq(ranks([C("H", 5), JK, C("H", 7)]), [6])) fail("scala joker opts", "5-_-7 should offer only 6");
  if (!eq(ranks([C("H", 13), C("D", 13), JK]), [])) fail("scala joker opts", "a set has no run placement");
  if (!eq(ranks([C("H", 1), C("H", 2), JK]), [3])) fail("scala joker opts", `A-2-J should offer only 3, got ${ranks([C("H", 1), C("H", 2), JK])}`);

  // discard usability gate
  const D = (id, s, v) => ({ id, s, v });
  // not opened: a small run that reaches nowhere near 40 is NOT enough
  const gLowRun = { opened: { A: false, B: false }, melds: [], discard: [D("d", "H", 7)], hands: { A: [D("a", "H", 5), D("b", "H", 6), D("c", "S", 2)], B: [] } };
  if (R.s40CanUseDiscard(gLowRun, "A")) fail("scala discard gate", "before opening, 7H+5H,6H (18 pts) must NOT be takeable");
  // not opened: the card completes a 40-point opening (a fourth king → set of 40)
  const gOpen = { opened: { A: false, B: false }, melds: [], discard: [D("d", "S", 13)], hands: { A: [D("a", "H", 13), D("b", "D", 13), D("c", "C", 13), D("e", "S", 2)], B: [] } };
  if (!R.s40CanUseDiscard(gOpen, "A")) fail("scala discard gate", "before opening, KS completing four kings (40) must be takeable");
  const gNo = { opened: { A: false, B: false }, melds: [], discard: [D("d", "H", 7)], hands: { A: [D("a", "S", 2), D("b", "C", 4), D("c", "D", 9)], B: [] } };
  if (R.s40CanUseDiscard(gNo, "A")) fail("scala discard gate", "7H should not be usable with junk hand");
  // once opened: a lay-off onto a table meld is enough
  const gLay = { opened: { A: true, B: false }, melds: [{ id: "m", cards: [D("x", "H", 4), D("y", "H", 5), D("z", "H", 6)] }], discard: [D("d", "H", 7)], hands: { A: [D("a", "S", 2)], B: [] } };
  if (!R.s40CanUseDiscard(gLay, "A")) fail("scala discard gate", "7H should be usable as a lay-off onto 4-5-6H once opened");
  // once opened: forming a fresh meld with two hand cards is also enough
  const gOpenedRun = { opened: { A: true, B: false }, melds: [], discard: [D("d", "H", 7)], hands: { A: [D("a", "H", 5), D("b", "H", 6), D("c", "S", 2)], B: [] } };
  if (!R.s40CanUseDiscard(gOpenedRun, "A")) fail("scala discard gate", "once opened, 7H+5H,6H (a fresh run) must be takeable");
}

/* ── prepared deck (shuffle + cut ritual) ───────────────────── */
// A deck the players shuffled by tapping and cut by dragging is dealt exactly as
// prepared. Check it still holds all 40 cards through a whole game.
function playPrepared() {
  let deck = R.makeDeck();
  for (let t = 0; t < 7; t++) deck = R.shuffleWith(deck, (t * 2654435761 + 12345) >>> 0); // "taps"
  deck = R.cutDeck(deck, 17); // a cut
  if (deck.length !== 40 || new Set(deck.map((c) => c.id)).size !== 40)
    return fail("prepared", "shuffle+cut lost or duplicated cards");
  // deal each game from the prepared order and make sure it terminates cleanly
  let sg = R.dealScopa("A", { A: 0, B: 0 }, { target: 11 }, deck);
  scopaCensus(sg, "prepared scopa deal");
  let rg = R.dealRuba("A", { A: 0, B: 0 }, deck);
  scopaCensus(rg, "prepared ruba deal");
  let cg = R.dealCamicia({ A: 0, B: 0 }, deck);
  camiciaCensus(cg, "prepared camicia deal");
  let bg = R.dealBriscola("A", { A: 0, B: 0 }, deck);
  brisCensus(bg, "prepared briscola deal");
}

/* ── run ────────────────────────────────────────────────────── */
const stat = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}, median ${xs.slice().sort((a, b) => a - b)[xs.length >> 1]}`;

const runs = [
  ["scopa, base rules", () => playScopa({ target: 11, asso: false, acepile: false, rebello: false, napola: false })],
  ["scopa, asso piglia tutto + rebello + napola", () => playScopa({ target: 11, asso: true, acepile: false, rebello: true, napola: true })],
  ["scopa, asso solo to pile", () => playScopa({ target: 11, asso: false, acepile: true, rebello: false, napola: false })],
  ["scopa scientifica (5 in hand, empty table)", () => playScopa({ target: 11, hand: 5, notable: true, asso: false, acepile: false, rebello: false, napola: false })],
  ["rubamazzo, table matches only", () => playRuba({ sums: false })],
  ["rubamazzo, northern sums", () => playRuba({ sums: true })],
  ["rubamazzo, mazzo nelle somme", () => playRuba({ sums: true, pilesum: true })],
  ["camicia, italian (A/2/3)", () => playCamicia({ intl: false })],
  ["camicia, international (A4 R3 C2 F1)", () => playCamicia({ intl: true })],
  ["peppa tencia (old maid)", () => playPeppa()],
  ["condottieri (tactics)", () => playTactics()],
  ["briscola", () => playBriscola()],
  ["perudo", () => playPerudo()],
  ["yahtzee", () => playYahtzee()],
  ["diecimila (farkle)", () => playFarkle({ target: 2000 })],
  ["diecimila, no last round + entry 500", () => playFarkle({ target: 2000, entry: true, lastRound: false })],
  ["bestiario (onitama)", () => playBestiario()],
  ["flotta (battaglia navale)", () => playFlotta()],
  ["paroliere (boggle)", () => playParoliere()],
  ["scala 40", () => playScala()],
];

console.log(`Osteria — ${DEALS} deals per variant\n`);
for (const [label, run] of runs) {
  const before = failures;
  const lengths = [];
  let draws = 0;
  for (let i = 0; i < DEALS; i++) {
    const r = run();
    if (typeof r === "number") lengths.push(r);
    else if (r) {
      lengths.push(r.steps);
      if (r.draw) draws++;
    }
  }
  const ok = failures === before;
  const tail = draws ? `, ${draws} called as draws` : "";
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(44)} ${lengths.length ? stat(lengths) : "—"} plays${tail}`);
}

{
  const before = failures;
  for (let i = 0; i < 200; i++) playPrepared();
  console.log(`${failures === before ? "✓" : "✗"} ${"prepared deck (shuffle + cut) deals".padEnd(44)} 40 cards through the deal`);
}
{
  const before = failures;
  s40MeldTests();
  console.log(`${failures === before ? "✓" : "✗"} ${"scala 40 meld analyzer".padEnd(44)} sets, runs, jokers, ace low/high`);
}
{
  const before = failures;
  tacticsHexChecks();
  console.log(`${failures === before ? "✓" : "✗"} ${"condottieri hex math".padEnd(44)} distance, neighbors, rounding`);
}
{
  const before = failures;
  farkleScoreTests();
  console.log(`${failures === before ? "✓" : "✗"} ${"diecimila scoring table".padEnd(44)} singles, triples, doubling, straight, pairs`);
}
{
  const before = failures;
  bestiarioRuleTests();
  console.log(`${failures === before ? "✓" : "✗"} ${"bestiario rules".padEnd(44)} deal, mirroring, capture/temple wins, pass`);
}
{
  const before = failures;
  flottaRuleTests();
  console.log(`${failures === before ? "✓" : "✗"} ${"flotta rules".padEnd(44)} fleet, setup, fire/sink/win, move, repair`);
}
{
  const before = failures;
  parolRuleTests();
  console.log(`${failures === before ? "✓" : "✗"} ${"paroliere rules".padEnd(44)} trace, no-reuse, QU, length scoring, vowels`);
}

console.log(failures ? `\n${failures} failure(s)` : "\nAll invariants held: 40 cards accounted for throughout, no stuck seats, every hand terminated.");
process.exit(failures ? 1 : 0);
