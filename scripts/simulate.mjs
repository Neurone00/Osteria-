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
  "makePeppaDeck", "dealPeppa", "peppaDraw", "peppaShed", "peppaShuffle", "peppaReady",
  "dealBriscola", "briscolaPlay", "brisPoints",
  "dealPerudo", "perudoRoll", "perudoBid", "perudoDoubt", "perudoNext",
  "dealYahtzee", "yahtRoll", "yahtScore", "yahtValue", "yahtTotal", "YCATS",
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
  const gU = { opened: { A: false, B: false }, melds: [], discard: [D("d", "H", 7)], hands: { A: [D("a", "H", 5), D("b", "H", 6), D("c", "S", 2)], B: [] } };
  if (!R.s40CanUseDiscard(gU, "A")) fail("scala discard gate", "7H should be usable with 5H,6H (run)");
  const gNo = { opened: { A: false, B: false }, melds: [], discard: [D("d", "H", 7)], hands: { A: [D("a", "S", 2), D("b", "C", 4), D("c", "D", 9)], B: [] } };
  if (R.s40CanUseDiscard(gNo, "A")) fail("scala discard gate", "7H should not be usable with junk hand");
  const gLay = { opened: { A: true, B: false }, melds: [{ id: "m", cards: [D("x", "H", 4), D("y", "H", 5), D("z", "H", 6)] }], discard: [D("d", "H", 7)], hands: { A: [D("a", "S", 2)], B: [] } };
  if (!R.s40CanUseDiscard(gLay, "A")) fail("scala discard gate", "7H should be usable as a lay-off onto 4-5-6H");
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
  ["briscola", () => playBriscola()],
  ["perudo", () => playPerudo()],
  ["yahtzee", () => playYahtzee()],
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

console.log(failures ? `\n${failures} failure(s)` : "\nAll invariants held: 40 cards accounted for throughout, no stuck seats, every hand terminated.");
process.exit(failures ? 1 : 0);
