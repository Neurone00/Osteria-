import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

/* ═══════════════════════════ tokens ═══════════════════════════ */
const T = {
  bg: "#E7E5E0",
  bgDeep: "#DAD8D2",
  ink: "#121212",
  ink60: "rgba(18,18,18,0.58)",
  ink30: "rgba(18,18,18,0.28)",
  line: "rgba(18,18,18,0.16)",
  paper: "#FFFFFF",
};
// Whimsical display face for the wordmark and headings — loaded from Google
// Fonts by the host page, with a rounded system fallback if it can't (e.g. the
// offline artifact). Body copy stays on the neutral system stack.
const BRAND = "'Fredoka', 'Baloo 2', ui-rounded, 'Segoe UI Rounded', system-ui, -apple-system, sans-serif";
const SUIT = {
  D: { name: "Denari", c: "#A8842A" },
  C: { name: "Coppe", c: "#A5342F" },
  S: { name: "Spade", c: "#2C557E" },
  B: { name: "Bastoni", c: "#3A6B4A" },
};
const RANKS = { 1: "A", 8: "F", 9: "C", 10: "R" };
const lbl = (v) => RANKS[v] || String(v);
const other = (s) => (s === "A" ? "B" : "A");
const who = (room, s) => room.names[s] || (s === "A" ? "Oste" : "Ospite");
const uid = () => Math.random().toString(36).slice(2, 9);

function makeDeck() {
  const d = [];
  for (const s of ["D", "C", "S", "B"]) for (let v = 1; v <= 10; v++) d.push({ id: s + v, s, v });
  return d;
}
function shuffle(a) {
  const d = a.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const tilt = (id) => (((id.charCodeAt(0) * 31 + id.charCodeAt(1) * 7) % 9) - 4) * 0.9;

// Deterministic PRNG so a shuffle is a pure function of the seed the UI gathers
// from the player's tapping (timing, rhythm, frame counter). Pure — no globals.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One human tap = one full riffle+overhand pass, driven entirely by `seed`.
function shuffleWith(deck, seed) {
  const rng = mulberry32(seed >>> 0);
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
// Cut: lift everything above `at` and drop it under the rest.
function cutDeck(deck, at) {
  const n = deck.length;
  const k = ((Math.round(at) % n) + n) % n;
  return [...deck.slice(k), ...deck.slice(0, k)];
}

/* ═══════════════════════════ rules ═══════════════════════════
   Sources consulted for this build:
   · Scopa / Asso piglia tutto — forced single-card capture, no scopa on the
     final play of a deal, primiera void without all four suits, optional
     napola and rebello, ace-sweep variant that does not score a scopa.
   · Rubamazzo — all table cards of equal value are taken at once, piles are
     stolen only by a direct value match on the exposed top card, table
     remainder goes to the last player who captured.
   · Straccia camicia — Italian baseline: asso, due and tre are the only
     attacking cards, demanding 1, 2 and 3 payments. International variant
     (A 4 · R 3 · C 2 · F 1) offered as a toggle.
   ══════════════════════════════════════════════════════════════ */

const PRIM = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

const GAMES = {
  scopa: {
    name: "Scopa",
    tag: "3 carte a testa",
    line: "Prendi una carta di ugual valore, o una somma. Svuota il tavolo per fare scopa.",
    opts: [
      { k: "target", label: "Partita a", cycle: [11, 16, 21] },
      { k: "asso", label: "Asso piglia tutto", cycle: [false, true] },
      { k: "acepile", label: "Asso solo → in pila", cycle: [false, true] },
      { k: "rebello", label: "Rebello (re di denari)", cycle: [false, true] },
      { k: "napola", label: "Napola", cycle: [false, true] },
    ],
    def: { target: 11, asso: false, acepile: false, rebello: false, napola: false },
  },
  ruba: {
    name: "Rubamazzo",
    tag: "ruba il mazzo",
    line: "Abbina il tavolo per raccogliere. Abbina la cima di un mazzo e lo rubi tutto.",
    opts: [{ k: "sums", label: "Somme del nord", cycle: [false, true] }],
    def: { sums: false },
  },
  camicia: {
    name: "Straccia camicia",
    tag: "niente scelte, solo nervi",
    line: "Gira la carta in cima. Asso, due e tre fanno pagare 1, 2 o 3 all’altro.",
    opts: [{ k: "intl", label: "Variante figure (A4 R3 C2 F1)", cycle: [false, true] }],
    def: { intl: false },
  },
  briscola: {
    name: "Briscola",
    tag: "la briscola comanda",
    line: "Prendi con la carta più forte, o taglia con una briscola. Chi fa più punti su 120 vince.",
    opts: [],
    def: {},
  },
  perudo: {
    name: "Perudo",
    tag: "dadi e bugie",
    line: "Cinque dadi a testa, nascosti. Rilancia sulla quantità di una faccia (gli 1 sono jolly) o grida Dubito.",
    dice: true,
    opts: [],
    def: {},
  },
  yahtzee: {
    name: "Yahtzee",
    tag: "cinque dadi, tre tiri",
    line: "Tira fino a tre volte tenendo i dadi che vuoi, poi segna in una casella. Più punti in tredici turni.",
    dice: true,
    opts: [],
    def: {},
  },
};
const isCard = (game) => !GAMES[game].dice;

/* ── scopa ─────────────────────────────────────────────────── */
// `pre` is a deck the players shuffled and cut by hand; when given it's dealt
// exactly as prepared (no reshuffle guard — their cut is respected).
function dealScopa(dealer, scores, o, pre) {
  let deck, table;
  if (pre) {
    deck = pre.slice();
    table = deck.splice(0, 4);
  } else
    do {
      deck = shuffle(makeDeck());
      table = deck.splice(0, 4);
    } while (table.filter((c) => c.v === 10).length >= 3);
  return {
    deck,
    table,
    hands: { A: deck.splice(0, 3), B: deck.splice(0, 3) },
    piles: { A: [], B: [] },
    scope: { A: 0, B: 0 },
    turn: other(dealer),
    dealer,
    last: null,
    scores: scores || { A: 0, B: 0 },
    summary: null,
    done: false,
    matchDone: false,
  };
}

function scopaOptions(card, table, o) {
  if (o.asso && card.v === 1) return table.length ? [table.map((c) => c.id)] : [];
  const singles = table.filter((t) => t.v === card.v);
  if (singles.length) return singles.map((t) => [t.id]);
  const out = [];
  const seen = new Set();
  for (let m = 1; m < 1 << table.length; m++) {
    let sum = 0;
    const ids = [];
    const vs = [];
    for (let i = 0; i < table.length; i++)
      if (m & (1 << i)) {
        sum += table[i].v;
        ids.push(table[i].id);
        vs.push(table[i].v);
      }
    if (sum === card.v && ids.length > 1) {
      const k = vs.sort((a, b) => a - b).join(".");
      if (!seen.has(k)) {
        seen.add(k);
        out.push(ids);
      }
    }
  }
  return out;
}

function primiera(pile) {
  let sum = 0;
  let full = true;
  for (const s of ["D", "C", "S", "B"]) {
    const best = pile.filter((c) => c.s === s).reduce((m, c) => Math.max(m, PRIM[c.v]), 0);
    if (!best) full = false;
    sum += best;
  }
  return { sum, full };
}

function scoreScopa(g, o) {
  const lines = [];
  const pts = { A: 0, B: 0 };
  const add = (seat, n, why) => {
    pts[seat] += n;
    lines.push({ seat, n, why });
  };
  const n = { A: g.piles.A.length, B: g.piles.B.length };
  if (n.A !== n.B) add(n.A > n.B ? "A" : "B", 1, "Carte");
  const d = { A: g.piles.A.filter((c) => c.s === "D").length, B: g.piles.B.filter((c) => c.s === "D").length };
  if (d.A !== d.B) add(d.A > d.B ? "A" : "B", 1, "Denari");
  add(g.piles.A.some((c) => c.id === "D7") ? "A" : "B", 1, "Settebello");
  const pa = primiera(g.piles.A);
  const pb = primiera(g.piles.B);
  if (pa.full && pb.full) {
    if (pa.sum !== pb.sum) add(pa.sum > pb.sum ? "A" : "B", 1, "Primiera");
  } else if (pa.full !== pb.full) add(pa.full ? "A" : "B", 1, "Primiera");
  if (o.rebello) add(g.piles.A.some((c) => c.id === "D10") ? "A" : "B", 1, "Rebello");
  if (o.napola)
    for (const seat of ["A", "B"]) {
      const den = new Set(g.piles[seat].filter((c) => c.s === "D").map((c) => c.v));
      if (den.has(1) && den.has(2) && den.has(3)) {
        let run = 3;
        while (den.has(run + 1)) run++;
        add(seat, run, "Napola");
      }
    }
  if (g.scope.A) add("A", g.scope.A, g.scope.A > 1 ? "Scope" : "Scopa");
  if (g.scope.B) add("B", g.scope.B, g.scope.B > 1 ? "Scope" : "Scopa");
  return { pts, lines };
}

function scopaPlay(gs, seat, cardId, take, o) {
  const g = clone(gs);
  const i = g.hands[seat].findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = g.hands[seat].splice(i, 1)[0];
  let kind = "lay";
  // ev is a structured event; the client renders it into a sentence using the
  // reader's own deck names, so the nomenclature always matches what they see.
  let ev = { t: "lay", v: card.v, s: card.s };
  if (take && take.length) {
    const onlyAce = g.table.length === 1 && g.table[0].v === 1;
    const aceSweep = o.asso && card.v === 1 && !onlyAce;
    const got = g.table.filter((c) => take.includes(c.id));
    g.table = g.table.filter((c) => !take.includes(c.id));
    g.piles[seat].push(...got, card);
    g.last = seat;
    const finalPlay = g.deck.length === 0 && g.hands.A.length === 0 && g.hands.B.length === 0;
    if (g.table.length === 0 && !finalPlay && !aceSweep) {
      g.scope[seat] += 1;
      kind = "scopa";
      ev = { t: "scopa" };
    } else {
      kind = "take";
      ev = { t: "take", v: card.v, s: card.s, got: got.map((c) => c.v) };
    }
  } else if (o.acepile && card.v === 1) {
    // House rule: an asso played with nothing to capture is banked straight to
    // your pile instead of being laid on the table. It counts as a take (never
    // a scopa — the table is untouched), so the last-taker credit follows too.
    g.piles[seat].push(card);
    g.last = seat;
    kind = "take";
    ev = { t: "bank" };
  } else g.table.push(card);
  g.turn = other(seat);

  if (!g.hands.A.length && !g.hands.B.length) {
    if (g.deck.length >= 6) {
      g.hands[other(g.dealer)] = g.deck.splice(0, 3);
      g.hands[g.dealer] = g.deck.splice(0, 3);
      g.turn = other(g.dealer);
    } else {
      if (g.last) {
        g.piles[g.last].push(...g.table);
        g.table = [];
      }
      const r = scoreScopa(g, o);
      g.scores = { A: g.scores.A + r.pts.A, B: g.scores.B + r.pts.B };
      g.summary = r;
      g.done = true;
      const { A, B } = g.scores;
      g.matchDone = (A >= o.target || B >= o.target) && A !== B;
    }
  }
  return { g, kind, ev, card };
}

/* ── rubamazzo ─────────────────────────────────────────────── */
function dealRuba(dealer, tally, pre) {
  const deck = pre ? pre.slice() : shuffle(makeDeck());
  const table = deck.splice(0, 4);
  return {
    deck,
    table,
    hands: { A: deck.splice(0, 3), B: deck.splice(0, 3) },
    piles: { A: [], B: [] },
    turn: other(dealer),
    dealer,
    last: null,
    tally: tally || { A: 0, B: 0 },
    summary: null,
    done: false,
    matchDone: false,
  };
}

function rubaOptions(card, g, seat, o) {
  const out = [];
  const same = g.table.filter((t) => t.v === card.v);
  if (same.length) out.push({ type: "table", ids: same.map((c) => c.id) });
  else if (o.sums) {
    const seen = new Set();
    for (let m = 1; m < 1 << g.table.length; m++) {
      let sum = 0;
      const ids = [];
      const vs = [];
      for (let i = 0; i < g.table.length; i++)
        if (m & (1 << i)) {
          sum += g.table[i].v;
          ids.push(g.table[i].id);
          vs.push(g.table[i].v);
        }
      if (sum === card.v && ids.length > 1) {
        const k = vs.sort((a, b) => a - b).join(".");
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ type: "table", ids });
        }
      }
    }
  }
  const opp = g.piles[other(seat)];
  if (opp.length && opp[opp.length - 1].v === card.v) out.push({ type: "steal" });
  return out;
}

function rubaPlay(gs, seat, cardId, opt) {
  const g = clone(gs);
  const i = g.hands[seat].findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = g.hands[seat].splice(i, 1)[0];
  let kind = "lay";
  let ev = { t: "lay", v: card.v, s: card.s };
  if (opt && opt.type === "steal") {
    const pile = g.piles[other(seat)];
    kind = "scopa";
    ev = { t: "steal", v: card.v, s: card.s, n: pile.length };
    g.piles[seat] = [...g.piles[seat], ...pile, card];
    g.piles[other(seat)] = [];
    g.last = seat;
  } else if (opt && opt.type === "table") {
    const got = g.table.filter((c) => opt.ids.includes(c.id));
    g.table = g.table.filter((c) => !opt.ids.includes(c.id));
    g.piles[seat].push(...got, card);
    g.last = seat;
    kind = "take";
    ev = { t: "rtake", v: card.v, s: card.s, n: got.length };
  } else g.table.push(card);
  g.turn = other(seat);

  if (!g.hands.A.length && !g.hands.B.length) {
    if (g.deck.length >= 6) {
      g.hands[other(g.dealer)] = g.deck.splice(0, 3);
      g.hands[g.dealer] = g.deck.splice(0, 3);
      g.turn = other(g.dealer);
    } else {
      if (g.last) {
        g.piles[g.last].push(...g.table);
        g.table = [];
      }
      const a = g.piles.A.length;
      const b = g.piles.B.length;
      const win = a === b ? null : a > b ? "A" : "B";
      if (win) g.tally[win] += 1;
      g.summary = { a, b, win };
      g.done = true;
      g.matchDone = true;
    }
  }
  return { g, kind, ev, card };
}

/* ── straccia camicia ──────────────────────────────────────── */
const demand = (v, intl) => (intl ? { 1: 4, 10: 3, 9: 2, 8: 1 }[v] || 0 : { 1: 1, 2: 2, 3: 3 }[v] || 0);

function dealCamicia(tally, pre) {
  const d = pre ? pre.slice() : shuffle(makeDeck());
  return {
    decks: { A: d.slice(0, 20), B: d.slice(20) },
    center: [],
    turn: "A",
    debt: 0,
    owed: null,
    flips: 0,
    tally: tally || { A: 0, B: 0 },
    done: false,
    matchDone: false,
    win: null,
  };
}

function camiciaFlip(gs, seat, o) {
  const g = clone(gs);
  if (g.turn !== seat || g.done) return null;
  const card = g.decks[seat].shift();
  if (!card) return null;
  g.center.push(card);
  g.flips++;
  const d = demand(card.v, o.intl);
  let kind = "lay";
  let ev = { t: "turn", v: card.v, s: card.s };
  if (d > 0) {
    g.owed = seat;
    g.debt = d;
    g.turn = other(seat);
    kind = "take";
    ev = { t: "attack", v: card.v, s: card.s, d };
  } else if (g.debt > 0) {
    g.debt -= 1;
    if (g.debt === 0) {
      const n = g.center.length;
      g.decks[g.owed].push(...g.center);
      g.center = [];
      g.turn = g.owed;
      kind = "scopa";
      ev = { t: "pay", n };
      g.owed = null;
    }
  } else g.turn = other(seat);

  if (!g.decks[g.turn].length && !g.done) {
    g.done = true;
    g.matchDone = true;
    g.win = other(g.turn);
    g.tally[g.win] += 1;
  }
  if (g.flips > 900 && !g.done) {
    g.done = true;
    g.matchDone = true;
    g.win = null;
  }
  return { g, kind, ev, card };
}

/* ── briscola ──────────────────────────────────────────────────
   2-player Briscola. Points: A 11, 3 10, Re 4, Cavallo 3, Fante 2, rest 0
   (120 total). Beating order within a suit follows those points, then 7·6·5·4·2.
   No obligation to follow suit; a briscola (trump) beats any non-trump. Winner
   of a trick draws first, then the loser, until the stock (briscola last) runs
   out; then the last three tricks are played from the hand. 61 points wins. */
const BPTS = { 1: 11, 3: 10, 10: 4, 9: 3, 8: 2 };
const bpts = (v) => BPTS[v] || 0;
const BRANK = { 1: 10, 3: 9, 10: 8, 9: 7, 8: 6, 7: 5, 6: 4, 5: 3, 4: 2, 2: 1 };
const brisPoints = (pile) => pile.reduce((s, c) => s + bpts(c.v), 0);

function dealBriscola(dealer, tally, pre) {
  const d = pre ? pre.slice() : shuffle(makeDeck());
  const hands = { A: d.splice(0, 3), B: d.splice(0, 3) };
  const brisc = d.shift(); // the exposed trump indicator…
  d.push(brisc); // …kept at the bottom of the stock, drawn last
  return {
    deck: d,
    briscola: brisc,
    trump: brisc.s,
    hands,
    piles: { A: [], B: [] },
    lead: null, // { seat, card } once a trick is half-played
    turn: other(dealer),
    leader: other(dealer),
    dealer,
    tally: tally || { A: 0, B: 0 },
    summary: null,
    done: false,
    matchDone: false,
    win: null,
  };
}

function brisWinner(lead, resp, trump) {
  if (resp.card.s === lead.card.s) return BRANK[resp.card.v] > BRANK[lead.card.v] ? resp.seat : lead.seat;
  if (resp.card.s === trump) return resp.seat;
  return lead.seat;
}

function briscolaPlay(gs, seat, cardId) {
  const g = clone(gs);
  if (g.turn !== seat || g.done) return null;
  const i = g.hands[seat].findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = g.hands[seat].splice(i, 1)[0];
  let kind = "lay";
  let ev;
  if (!g.lead) {
    g.lead = { seat, card };
    g.turn = other(seat);
    ev = { t: "blead", v: card.v, s: card.s };
  } else {
    const win = brisWinner(g.lead, { seat, card }, g.trump);
    g.piles[win].push(g.lead.card, card);
    g.lead = null;
    const loser = other(win);
    if (g.deck.length) g.hands[win].push(g.deck.shift());
    if (g.deck.length) g.hands[loser].push(g.deck.shift());
    g.leader = win;
    g.turn = win;
    kind = win === seat ? "take" : "lay";
    ev = { t: "btake", v: card.v, s: card.s, win };
    if (!g.hands.A.length && !g.hands.B.length) {
      const a = brisPoints(g.piles.A);
      const b = brisPoints(g.piles.B);
      const w = a === b ? null : a > b ? "A" : "B";
      if (w) g.tally[w] += 1;
      g.summary = { a, b, win: w };
      g.done = true;
      g.matchDone = true;
      g.win = w;
    }
  }
  return { g, kind, ev, card };
}

/* ── dice ─────────────────────────────────────────────────────── */
const rollN = (n) => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));

/* ── perudo / dudo ─────────────────────────────────────────────
   Two players, five dice each, hidden. Bid a quantity of a face across ALL dice;
   ones are wild. Raise (more dice, or same count of a higher face) or call Dudo.
   On a call the dice show: if the bid holds the doubter loses a die, else the
   bidder does. Lose your last die and you are out. Faces bid are 2–6. */
function dealPerudo(starter, tally) {
  return {
    dice: { A: [], B: [] },
    counts: { A: 5, B: 5 },
    phase: "roll",
    rolled: { A: false, B: false },
    turn: starter,
    starter,
    bid: null,
    reveal: null,
    tally: tally || { A: 0, B: 0 },
    done: false,
    matchDone: false,
    win: null,
  };
}
function perudoRoll(gs, seat) {
  const g = clone(gs);
  if (g.phase !== "roll" || g.turn !== seat || g.rolled[seat]) return null;
  g.dice[seat] = rollN(g.counts[seat]);
  g.rolled[seat] = true;
  if (g.rolled.A && g.rolled.B) {
    g.phase = "bid";
    g.turn = g.starter;
  } else g.turn = other(seat);
  return { g, kind: "take", ev: { t: "roll" } };
}
function bidValid(prev, qty, face) {
  if (face < 2 || face > 6 || qty < 1) return false;
  if (!prev) return true;
  if (qty > prev.qty) return true;
  return qty === prev.qty && face > prev.face;
}
function perudoBid(gs, seat, qty, face) {
  const g = clone(gs);
  if (g.phase !== "bid" || g.turn !== seat || !bidValid(g.bid, qty, face)) return null;
  g.bid = { seat, qty, face };
  g.turn = other(seat);
  return { g, kind: "lay", ev: { t: "bid", qty, face } };
}
function perudoDoubt(gs, seat) {
  const g = clone(gs);
  if (g.phase !== "bid" || g.turn !== seat || !g.bid) return null;
  const actual = [...g.dice.A, ...g.dice.B].filter((d) => d === g.bid.face || d === 1).length;
  const holds = actual >= g.bid.qty; // bid true → the doubter loses
  const loser = holds ? seat : g.bid.seat;
  g.counts[loser] -= 1;
  g.reveal = { qty: g.bid.qty, face: g.bid.face, actual, doubter: seat, loser, dice: { A: g.dice.A.slice(), B: g.dice.B.slice() } };
  g.phase = "reveal";
  if (g.counts[loser] <= 0) {
    g.done = true;
    g.matchDone = true;
    g.win = other(loser);
    g.tally[g.win] += 1;
  }
  return { g, kind: "scopa", ev: { t: "doubt" } };
}
function perudoNext(gs, seat) {
  const g = clone(gs);
  if (g.phase !== "reveal" || g.done || seat !== g.reveal.loser) return null;
  const st = g.reveal.loser;
  g.starter = st;
  g.turn = st;
  g.phase = "roll";
  g.rolled = { A: false, B: false };
  g.dice = { A: [], B: [] };
  g.bid = null;
  g.reveal = null;
  return { g, kind: "lay", ev: { t: "next" } };
}

/* ── yahtzee ───────────────────────────────────────────────────
   Five dice, up to three rolls a turn (keep between rolls), then score into one
   of thirteen boxes. Thirteen turns each; +35 upper bonus at 63. Higher total wins. */
const YCATS = [
  { k: "uno", label: "Uno", up: 1 },
  { k: "due", label: "Due", up: 2 },
  { k: "tre", label: "Tre", up: 3 },
  { k: "quattro", label: "Quattro", up: 4 },
  { k: "cinque", label: "Cinque", up: 5 },
  { k: "sei", label: "Sei", up: 6 },
  { k: "tris", label: "Tris" },
  { k: "poker", label: "Poker" },
  { k: "full", label: "Full" },
  { k: "scala", label: "Scala" },
  { k: "scalona", label: "Scalona" },
  { k: "cinquina", label: "Cinquina" },
  { k: "chance", label: "Chance" },
];
function yahtValue(cat, dice) {
  if (!dice.length || dice.some((d) => !d)) return 0;
  const cnt = {};
  for (const d of dice) cnt[d] = (cnt[d] || 0) + 1;
  const sum = dice.reduce((s, d) => s + d, 0);
  const counts = Object.values(cnt);
  const has = (f) => cnt[f] > 0;
  const face = { uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6 };
  if (cat in face) return (cnt[face[cat]] || 0) * face[cat];
  switch (cat) {
    case "tris":
      return counts.some((c) => c >= 3) ? sum : 0;
    case "poker":
      return counts.some((c) => c >= 4) ? sum : 0;
    case "full":
      return counts.includes(3) && counts.includes(2) ? 25 : 0;
    case "scala":
      return [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].some((s) => s.every(has)) ? 30 : 0;
    case "scalona":
      return [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]].some((s) => s.every(has)) ? 40 : 0;
    case "cinquina":
      return counts.some((c) => c === 5) ? 50 : 0;
    case "chance":
      return sum;
    default:
      return 0;
  }
}
function yahtTotal(sc) {
  let upper = 0;
  let total = 0;
  for (const c of YCATS) {
    if (c.k in sc) {
      total += sc[c.k];
      if (c.up) upper += sc[c.k];
    }
  }
  const bonus = upper >= 63 ? 35 : 0;
  return { total: total + bonus, upper, bonus };
}
function dealYahtzee(dealer, tally) {
  return {
    turn: dealer,
    dice: [0, 0, 0, 0, 0],
    keep: [false, false, false, false, false],
    rollsLeft: 3,
    rolled: false,
    scores: { A: {}, B: {} },
    dealer,
    tally: tally || { A: 0, B: 0 },
    summary: null,
    done: false,
    matchDone: false,
    win: null,
  };
}
function yahtRoll(gs, seat) {
  const g = clone(gs);
  if (g.turn !== seat || g.rollsLeft <= 0 || g.done) return null;
  g.dice = g.dice.map((d, i) => (g.rolled && g.keep[i] ? d : 1 + Math.floor(Math.random() * 6)));
  g.rollsLeft -= 1;
  g.rolled = true;
  return { g, kind: "take", ev: { t: "roll" } };
}
function yahtToggle(gs, seat, i) {
  const g = clone(gs);
  if (g.turn !== seat || !g.rolled || g.done) return null;
  g.keep[i] = !g.keep[i];
  return { g, kind: "lay", ev: { t: "keep" } };
}
function yahtScore(gs, seat, cat) {
  const g = clone(gs);
  if (g.turn !== seat || !g.rolled || g.done || cat in g.scores[seat]) return null;
  g.scores[seat][cat] = yahtValue(cat, g.dice);
  g.turn = other(seat);
  g.dice = [0, 0, 0, 0, 0];
  g.keep = [false, false, false, false, false];
  g.rollsLeft = 3;
  g.rolled = false;
  if (Object.keys(g.scores.A).length === 13 && Object.keys(g.scores.B).length === 13) {
    const a = yahtTotal(g.scores.A).total;
    const b = yahtTotal(g.scores.B).total;
    const w = a === b ? null : a > b ? "A" : "B";
    if (w) g.tally[w] += 1;
    g.summary = { a, b, win: w };
    g.done = true;
    g.matchDone = true;
    g.win = w;
  }
  return { g, kind: "scopa", ev: { t: "score", cat } };
}

/* ═══════════════════════════ feedback ═══════════════════════════ */
let AC = null;
function slamSound(kind, on) {
  if (!on) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const t = AC.currentTime;
    const n = AC.createBufferSource();
    const len = Math.floor(AC.sampleRate * 0.09);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    n.buffer = buf;
    const bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = kind === "lay" ? 1700 : 2400;
    bp.Q.value = 0.8;
    const ng = AC.createGain();
    ng.gain.value = kind === "lay" ? 0.16 : 0.26;
    n.connect(bp).connect(ng).connect(AC.destination);
    n.start(t);
    const o = AC.createOscillator();
    const og = AC.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    og.gain.setValueAtTime(kind === "lay" ? 0.22 : 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og).connect(AC.destination);
    o.start(t);
    o.stop(t + 0.2);
    if (kind === "scopa") {
      const b = AC.createOscillator();
      const bg = AC.createGain();
      b.type = "triangle";
      b.frequency.setValueAtTime(880, t + 0.04);
      b.frequency.exponentialRampToValueAtTime(1320, t + 0.16);
      bg.gain.setValueAtTime(0.09, t + 0.04);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      b.connect(bg).connect(AC.destination);
      b.start(t + 0.04);
      b.stop(t + 0.28);
    }
  } catch {}
}
function buzz(kind) {
  try {
    navigator.vibrate?.(kind === "scopa" ? [24, 36, 40] : kind === "take" ? [20] : [12]);
  } catch {}
}
/* The finale sting: a rising fanfare for the winner, a short fall for the loser,
   one soft note on a draw. Seat-relative, so each phone plays its own. */
function winSound(outcome, on) {
  if (!on || !outcome) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const t = AC.currentTime + 0.02;
    const notes = outcome === "win" ? [523.25, 659.25, 783.99, 1046.5] : outcome === "lose" ? [415.3, 311.13] : [587.33];
    const step = outcome === "win" ? 0.12 : 0.17;
    notes.forEach((f, i) => {
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = outcome === "win" ? "triangle" : "sine";
      const ts = t + i * step;
      o.frequency.setValueAtTime(f, ts);
      g.gain.setValueAtTime(0.0001, ts);
      g.gain.exponentialRampToValueAtTime(outcome === "win" ? 0.24 : 0.16, ts + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ts + (outcome === "win" ? 0.44 : 0.5));
      o.connect(g).connect(AC.destination);
      o.start(ts);
      o.stop(ts + 0.7);
    });
    if (outcome === "win") {
      // a little bell shimmer on top
      const b = AC.createOscillator();
      const bg = AC.createGain();
      b.type = "sine";
      b.frequency.setValueAtTime(1568, t + 0.36);
      bg.gain.setValueAtTime(0.0001, t + 0.36);
      bg.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      b.connect(bg).connect(AC.destination);
      b.start(t + 0.36);
      b.stop(t + 0.95);
    }
  } catch {}
}

/* ═══════════════════════════ network ═══════════════════════════ */
const K = (c) => `osteria:${c}`;
const hasStore = () => typeof window !== "undefined" && !!window.storage;

async function storeRead(code) {
  try {
    const r = await window.storage.get(K(code), true);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}
async function storeWrite(room) {
  try {
    await window.storage.set(K(room.code), JSON.stringify(room), true);
    return true;
  } catch {
    return false;
  }
}
const SESSION = "osteria:session";
/* Reload guard. In the artifact this uses the private (non-shared) storage key;
   in a self-hosted build it falls back to sessionStorage. */
async function saveSession(s) {
  try {
    const v = JSON.stringify({ ...s, ts: Date.now() });
    if (hasStore()) await window.storage.set(SESSION, v, false);
    else sessionStorage.setItem(SESSION, v);
  } catch {}
}
async function loadSession() {
  try {
    if (hasStore()) {
      const r = await window.storage.get(SESSION, false);
      return r ? JSON.parse(r.value) : null;
    }
    const v = sessionStorage.getItem(SESSION);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
async function dropSession() {
  try {
    if (hasStore()) await window.storage.delete(SESSION, false);
    else sessionStorage.removeItem(SESSION);
  } catch {}
}

/* Local preferences that outlive a single table: the card face and each game's
   last-used house rules. Same artifact-safe pattern as the session — private
   window.storage inside the Claude artifact, localStorage on a self-hosted
   build (Cloudflare, a plain static host), never localStorage when
   window.storage exists. */
const PREFS = "osteria:prefs";
async function savePrefs(p) {
  try {
    const v = JSON.stringify(p);
    if (hasStore()) await window.storage.set(PREFS, v, false);
    else localStorage.setItem(PREFS, v);
  } catch {}
}
async function loadPrefs() {
  try {
    if (hasStore()) {
      const r = await window.storage.get(PREFS, false);
      return r ? JSON.parse(r.value) : null;
    }
    const v = localStorage.getItem(PREFS);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/* Same-origin WebSocket relay — the Cloudflare Worker in ./worker. If it isn't
   there (a plain static host), the app falls back to PeerJS on its own. */
function relayUrl(code) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/room/${code.toUpperCase()}`;
}

function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
    s.onload = () => res(window.Peer);
    s.onerror = () => rej(new Error("peerjs"));
    document.head.appendChild(s);
  });
}

/* ═══════════════════════════ qr ═══════════════════════════
   Self-contained QR encoder (byte mode, ECC M, versions 1–6) for the join link.
   Verified bit-for-bit against node-qrcode. No external requests, no imports. */
const qrEncode = (() => {
  // Minimal QR encoder: byte mode, ECC level M, versions 1–6, single alignment
  // pattern, no version-info block. Enough for a short URL. Returns a size×size
  // array of 0/1. Validated bit-for-bit against node-qrcode.
  
  // GF(256) tables (primitive polynomial 0x11d)
  const EXP = new Array(512);
  const LOG = new Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  
  function rsGenPoly(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, n) {
    const gen = rsGenPoly(n);
    const res = new Array(n).fill(0);
    for (const d of data) {
      const factor = d ^ res[0];
      res.shift();
      res.push(0);
      for (let j = 0; j < n; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }
  
  // version: {blocks, ec, data, align:[centers]}
  const VER = {
    1: { blocks: 1, ec: 10, data: 16, align: [] },
    2: { blocks: 1, ec: 16, data: 28, align: [18] },
    3: { blocks: 1, ec: 26, data: 44, align: [22] },
    4: { blocks: 2, ec: 18, data: 32, align: [26] },
    5: { blocks: 2, ec: 24, data: 43, align: [30] },
    6: { blocks: 4, ec: 16, data: 27, align: [34] },
  };
  const sizeOf = (v) => 17 + 4 * v;
  const capacityBytes = (v) => VER[v].blocks * VER[v].data - 2; // minus mode+count overhead (~2 bytes)
  
  function pickVersion(len) {
    for (let v = 1; v <= 6; v++) if (capacityBytes(v) >= len) return v;
    throw new Error("data too long for v1–6");
  }
  
  function encodeBits(text, v) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
    const bits = [];
    const push = (val, n) => {
      for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };
    push(0b0100, 4); // byte mode
    push(bytes.length, 8); // count (8 bits for v1–9)
    for (const b of bytes) push(b, 8);
    const totalData = VER[v].blocks * VER[v].data;
    const cap = totalData * 8;
    // terminator
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    // pad to byte
    while (bits.length % 8 !== 0) bits.push(0);
    // to bytes
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }
    // pad bytes
    const pads = [0xec, 0x11];
    let pi = 0;
    while (cw.length < totalData) cw.push(pads[pi++ % 2]);
    return cw;
  }
  
  function buildCodewords(text, v) {
    const dataCw = encodeBits(text, v);
    const { blocks, ec, data } = VER[v];
    const dataBlocks = [];
    const ecBlocks = [];
    for (let b = 0; b < blocks; b++) {
      const blk = dataCw.slice(b * data, (b + 1) * data);
      dataBlocks.push(blk);
      ecBlocks.push(rsEncode(blk, ec));
    }
    // interleave data then ecc
    const out = [];
    for (let i = 0; i < data; i++) for (let b = 0; b < blocks; b++) out.push(dataBlocks[b][i]);
    for (let i = 0; i < ec; i++) for (let b = 0; b < blocks; b++) out.push(ecBlocks[b][i]);
    return out;
  }
  
  function newMatrix(size) {
    return Array.from({ length: size }, () => new Array(size).fill(null));
  }
  function placeFinder(m, r, c) {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr,
          cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const on = inner && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        m[rr][cc] = on ? 1 : 0;
      }
  }
  function placeAlign(m, r, c) {
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        m[r + dr][c + dc] = on ? 1 : 0;
      }
  }
  function reserveFormat(m) {
    const size = m.length;
    for (let i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 2; // reserved
      if (m[i][8] === null) m[i][8] = 2;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 2;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 2;
    }
  }
  function functionPatterns(m, v) {
    const size = m.length;
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    // timing
    for (let i = 8; i < size - 8; i++) {
      if (m[6][i] === null) m[6][i] = i % 2 === 0 ? 1 : 0;
      if (m[i][6] === null) m[i][6] = i % 2 === 0 ? 1 : 0;
    }
    // alignment
    for (const c of VER[v].align) placeAlign(m, c, c);
    // dark module
    m[size - 8][8] = 1;
    reserveFormat(m);
  }
  
  function placeData(m, cw) {
    const size = m.length;
    const bits = [];
    for (const b of cw) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    let idx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // skip timing column
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (m[row][c] === null) {
            m[row][c] = idx < bits.length ? bits[idx] : 0;
            idx++;
          }
        }
      }
      upward = !upward;
    }
  }
  
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  
  function isFunction(reserved, r, c) {
    return reserved[r][c] !== 0;
  }
  
  function applyMask(m, reserved, maskIdx) {
    const size = m.length;
    const out = m.map((row) => row.slice());
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        if (isFunction(reserved, r, c)) continue;
        if (maskFn[maskIdx](r, c)) out[r][c] ^= 1;
      }
    return out;
  }
  
  function penalty(m) {
    const size = m.length;
    let p = 0;
    // rule 1: runs
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) run++;
        else {
          if (run >= 5) p += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) run++;
        else {
          if (run >= 5) p += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
    // rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++)
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
      }
    // rule 3: finder-like patterns 1011101 with 4 light
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const check = (arr, i) => {
      for (let k = 0; k < 11; k++) if (arr[i + k] !== pat1[k]) return false;
      return true;
    };
    const check2 = (arr, i) => {
      for (let k = 0; k < 11; k++) if (arr[i + k] !== pat2[k]) return false;
      return true;
    };
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size - 10; c++) {
        const row = m[r];
        if (check(row, c) || check2(row, c)) p += 40;
      }
    for (let c = 0; c < size; c++) {
      const col = m.map((row) => row[c]);
      for (let r = 0; r < size - 10; r++) if (check(col, r) || check2(col, r)) p += 40;
    }
    // rule 4: dark ratio
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    const ratio = (dark * 100) / (size * size);
    const k = Math.floor(Math.abs(ratio - 50) / 5);
    p += k * 10;
    return p;
  }
  
  // format info: ECC level M = 0b00, mask 3 bits; BCH(15,5) with mask 0x5412
  function formatBits(maskIdx) {
    const ecBits = 0b00; // M
    let data = (ecBits << 3) | maskIdx;
    let d = data << 10;
    const g = 0b10100110111;
    for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= g << i;
    let bits = ((data << 10) | d) ^ 0b101010000010010;
    return bits & 0x7fff;
  }
  function placeFormat(m, maskIdx) {
    const size = m.length;
    const bits = formatBits(maskIdx);
    for (let i = 0; i < 15; i++) {
      const mod = (bits >> i) & 1;
      // vertical strip on column 8
      if (i < 6) m[i][8] = mod;
      else if (i < 8) m[i + 1][8] = mod;
      else m[size - 15 + i][8] = mod;
      // horizontal strip on row 8
      if (i < 8) m[8][size - 1 - i] = mod;
      else if (i < 9) m[8][7] = mod;
      else m[8][15 - i - 1] = mod;
    }
    m[size - 8][8] = 1; // fixed dark module
  }
  
  function qr(text) {
    const v = pickVersion(text.length);
    const size = sizeOf(v);
    const m = newMatrix(size);
    functionPatterns(m, v);
    // reserved map (function/reserved cells)
    const reserved = m.map((row) => row.map((x) => (x === null ? 0 : 1)));
    const cw = buildCodewords(text, v);
    placeData(m, cw);
    // normalize reserved 2 -> those are format cells, already function
    // choose mask
    let best = null;
    let bestP = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      const cand = applyMask(m, reserved, mk);
      placeFormat(cand, mk);
      const p = penalty(cand);
      if (p < bestP) {
        bestP = p;
        best = cand;
        best._mask = mk;
      }
    }
    return { size, version: v, matrix: best };
  }
  return qr;
})();

/* ═══════════════════════════ marks ═══════════════════════════ */
/* Card face is a per-device choice, not a table rule: each player sees the deck
   they picked. false → Napoletane (Italian suits, A/F/C/R); true → Francesi
   (French suits ♦♥♠♣, A/J/Q/K). Values and scoring never change. */
const SuitCtx = createContext(false);
const FR_SUIT = { D: { g: "♦", c: "#B23A2E" }, C: { g: "♥", c: "#B23A2E" }, S: { g: "♠", c: "#15181C" }, B: { g: "♣", c: "#15181C" } };
const FR_RANK = { 1: "A", 8: "J", 9: "Q", 10: "K" };
const FR_SUIT_NAME = { D: "quadri", C: "cuori", S: "picche", B: "fiori" };
const VS_TEXT = String.fromCharCode(0xfe0e); // force text (not emoji) rendering of ♦♥♠♣
const faceLbl = (v, french) => (french ? FR_RANK[v] || String(v) : lbl(v));
const suitName = (s, french) => (french ? FR_SUIT_NAME[s] : SUIT[s].name.toLowerCase());

// Render a move event into a sentence using the READER's deck, so the log always
// matches the card names that reader sees (Napoletane A/F/C/R vs Francesi A/J/Q/K).
function describe(ev, french) {
  if (!ev) return "";
  const r = (v) => faceLbl(v, french);
  switch (ev.t) {
    case "lay":
      return `cala il ${r(ev.v)} di ${suitName(ev.s, french)}`;
    case "take":
      return `prende ${ev.got.map(r).join("+")} con il ${r(ev.v)}`;
    case "scopa":
      return "svuota il tavolo — scopa";
    case "bank":
      return "incassa l’asso";
    case "steal":
      return `ruba un mazzo di ${ev.n} con il ${r(ev.v)}`;
    case "rtake":
      return `prende ${ev.n} con il ${r(ev.v)}`;
    case "turn":
      return `gira il ${r(ev.v)}`;
    case "attack":
      return `gira il ${r(ev.v)} — ${ev.d} da pagare`;
    case "pay":
      return `paga l’ultima — ${ev.n} carte cambiano mano`;
    case "blead":
      return `apre con il ${r(ev.v)} di ${suitName(ev.s, french)}`;
    case "btake":
      return `risponde con il ${r(ev.v)} di ${suitName(ev.s, french)}`;
    default:
      return "";
  }
}

function Pip({ suit, size = 20 }) {
  const french = useContext(SuitCtx);
  if (french) {
    const f = FR_SUIT[suit];
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="20"
          fontFamily="'Segoe UI Symbol','Noto Sans Symbols2','Apple Symbols',system-ui,sans-serif"
          fill={f.c}
        >
          {f.g + VS_TEXT}
        </text>
      </svg>
    );
  }
  const c = SUIT[suit].c;
  const p = { fill: "none", stroke: c, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {suit === "D" && (
        <>
          <circle cx="12" cy="12" r="7.2" {...p} />
          <circle cx="12" cy="12" r="2.1" fill={c} stroke="none" />
        </>
      )}
      {suit === "C" && (
        <>
          <path d="M6.4 6h11.2v2.2a5.6 5.6 0 0 1-11.2 0z" {...p} />
          <path d="M12 13.8v3.6" {...p} />
          <path d="M8.4 19h7.2" {...p} />
        </>
      )}
      {suit === "S" && (
        <>
          <path d="M12 3.2v11" {...p} />
          <path d="M7.6 14.4h8.8" {...p} />
          <circle cx="12" cy="19.2" r="2" {...p} />
        </>
      )}
      {suit === "B" && (
        <>
          <path d="M7.4 19.4 16.6 5.2" {...p} />
          <path d="M9.6 12.6 12 14.2" {...p} />
          <path d="M12.6 8.2 15 9.8" {...p} />
        </>
      )}
    </svg>
  );
}

const SZ = { xs: [36, 52], sm: [46, 66], md: [58, 82], lg: [74, 104] };

function Card({ card, size = "md", onClick, active, dim, slam, rot, enter }) {
  const french = useContext(SuitCtx);
  const [w, h] = SZ[size];
  const r = rot === undefined ? tilt(card.id) : rot;
  const cls = slam ? "slam" : enter ? "deal" : "";
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cls}
      style={{
        "--r": `${r}deg`,
        width: w,
        height: h,
        background: T.paper,
        border: `1px solid ${active ? T.ink : T.line}`,
        outline: active ? `2px solid ${T.ink}` : "none",
        outlineOffset: -3,
        borderRadius: 7,
        boxShadow: active
          ? `0 6px 16px rgba(18,18,18,0.18)`
          : `0 ${dim ? 1 : 2}px ${dim ? 3 : 7}px rgba(18,18,18,${dim ? 0.06 : 0.12})`,
        transform: `rotate(${r}deg) translateY(${active ? -10 : 0}px)`,
        transition: "transform 150ms cubic-bezier(.2,.9,.25,1), box-shadow 150ms",
        opacity: dim ? 0.5 : 1,
        position: "relative",
        flexShrink: 0,
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: size === "xs" ? 2 : 4,
          left: size === "xs" ? 4 : 5,
          fontSize: size === "lg" ? 15 : size === "md" ? 13 : 11,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: french ? FR_SUIT[card.s].c : T.ink,
          lineHeight: 1,
        }}
      >
        {faceLbl(card.v, french)}
      </span>
      <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <Pip suit={card.s} size={size === "lg" ? 30 : size === "md" ? 24 : 17} />
      </span>
    </button>
  );
}

function Back({ size = "sm", stack }) {
  const [w, h] = SZ[size];
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 7,
        background: T.ink,
        boxShadow: stack ? `2px 2px 0 ${T.bgDeep}, 3px 3px 0 ${T.ink}` : "0 1px 3px rgba(18,18,18,0.15)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div style={{ position: "absolute", inset: 5, border: `1px solid rgba(255,255,255,0.32)`, borderRadius: 3 }} />
    </div>
  );
}

function Ghost({ size = "sm" }) {
  const [w, h] = SZ[size];
  return <div style={{ width: w, height: h, border: `1px dashed ${T.ink30}`, borderRadius: 7, flexShrink: 0 }} />;
}

/* A physical stack of cards: the height of the pile encodes the count, so the
   amount reads at a glance without doing arithmetic. faceUp shows the top card
   (rubamazzo), otherwise a face-down deck (scopa piles, camicia packets). The
   pile grows up and toward `right` so it leans into the middle of the table. */
function Stack({ n, top, faceUp, size = "sm", right, slamId, grow = true }) {
  const [w, h] = SZ[size];
  if (!n) return <Ghost size={size} />;
  const layers = Math.min(n, 14);
  const dx = 1.5;
  const dy = 2.3;
  const spanX = (layers - 1) * dx;
  const spanY = (layers - 1) * dy;
  return (
    <div style={{ position: "relative", width: w + spanX, height: h + (grow ? spanY : 0), flexShrink: 0 }}>
      {Array.from({ length: layers }).map((_, i) => {
        const isTop = i === layers - 1;
        const style = {
          position: "absolute",
          left: right ? spanX - i * dx : i * dx,
          top: grow ? spanY - i * dy : 0,
        };
        if (isTop) {
          return (
            <div key="top" style={style}>
              {faceUp && top ? (
                <Card card={top} size={size} rot={0} slam={slamId === top.id} />
              ) : (
                <Back size={size} />
              )}
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              ...style,
              width: w,
              height: h,
              borderRadius: 7,
              background: faceUp ? T.paper : T.ink,
              border: `1px solid ${faceUp ? T.line : "rgba(255,255,255,0.10)"}`,
              boxShadow: "0 1px 2px rgba(18,18,18,0.10)",
            }}
          />
        );
      })}
    </div>
  );
}

/* A deck seen with a bit of depth: the top card floats over a visible block of
   card edges whose height grows with the count. Reads as a real, live pile and
   uses the vertical room a flat stack wastes. */
function Deck3D({ n, top, faceUp, size = "sm", slamId, live }) {
  const [w, h] = SZ[size];
  if (!n) return <Ghost size={size} />;
  const layers = Math.min(n, 26);
  const dy = 1.9; // thickness contributed by each visible edge
  const thickness = (layers - 1) * dy;
  return (
    <div style={{ position: "relative", width: w, height: h + thickness, flexShrink: 0 }}>
      {Array.from({ length: layers - 1 }, (_, i) => i)
        .reverse()
        .map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              top: (i + 1) * dy,
              width: w,
              height: h,
              borderRadius: 7,
              background: faceUp ? "#F2EFE8" : "#0e0e0e",
              borderBottom: `1px solid ${faceUp ? "rgba(18,18,18,0.14)" : "rgba(255,255,255,0.05)"}`,
              borderLeft: `1px solid ${faceUp ? "rgba(18,18,18,0.06)" : "transparent"}`,
              boxShadow: "-1px 1px 1px rgba(18,18,18,0.05)",
            }}
          />
        ))}
      <div className={live ? "floaty" : ""} style={{ position: "absolute", left: 0, top: 0 }}>
        {faceUp && top ? <Card card={top} size={size} rot={0} slam={slamId === top.id} /> : <Back size={size} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════ chrome ═══════════════════════════ */
const Micro = ({ children, style }) => (
  <div
    style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 10,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: T.ink60,
      ...style,
    }}
  >
    {children}
  </div>
);

function Button({ children, onClick, disabled, kind = "solid", full }) {
  const solid = kind === "solid";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: full ? "100%" : "auto",
        background: disabled ? "transparent" : solid ? T.ink : "transparent",
        color: disabled ? T.ink30 : solid ? T.bg : T.ink,
        border: `1.5px solid ${disabled ? T.line : T.ink}`,
        borderRadius: 12,
        padding: solid ? "15px 18px" : "13px 16px",
        fontFamily: BRAND,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function Rule() {
  return <div style={{ height: 1, background: T.line, margin: "18px 0" }} />;
}

const CSS = `
html,body{overscroll-behavior:none;margin:0;overflow-x:hidden}
.app{min-height:100vh;min-height:100dvh}
*{box-sizing:border-box}
button{font-family:inherit}
input{font-family:inherit}
@keyframes slamIn{
 0%{transform:translateY(-120px) rotate(calc(var(--r) + 9deg)) scale(1.5);opacity:0}
 55%{opacity:1}
 74%{transform:translateY(0) rotate(var(--r)) scale(1.05)}
 100%{transform:translateY(0) rotate(var(--r)) scale(1)}
}
.slam{animation:slamIn 380ms cubic-bezier(.2,.72,.2,1) both;z-index:3}
@keyframes jolt{
 0%{transform:translate(0,0)}22%{transform:translate(1.5px,-3px)}
 44%{transform:translate(-2px,2px)}66%{transform:translate(2px,1px)}
 84%{transform:translate(-1px,-1px)}100%{transform:translate(0,0)}
}
.jolt{animation:jolt 190ms ease-out}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.fade{animation:fadeUp 220ms ease-out both}
@keyframes dealIn{from{opacity:0;transform:translateY(10px) scale(.94)}to{opacity:1;transform:none}}
.deal{animation:dealIn 300ms cubic-bezier(.2,.9,.25,1) both}
@keyframes turnGlow{0%,100%{opacity:.55}50%{opacity:1}}
.turn{animation:turnGlow 2s ease-in-out infinite}
@keyframes swap{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.swap{animation:swap 260ms ease-out both}
.lift{transition:background 240ms ease, box-shadow 240ms ease, border-color 240ms ease}
@keyframes pop{0%{transform:scale(.4) rotate(-4deg);opacity:0}55%{transform:scale(1.14) rotate(1.5deg);opacity:1}72%{transform:scale(.95)}86%{transform:scale(1.02)}100%{transform:scale(1) rotate(0)}}
.pop{animation:pop 560ms cubic-bezier(.2,1.35,.35,1) both}
@keyframes fall{0%{transform:translateY(-24px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(320px) rotate(340deg);opacity:0}}
.confetti{animation:fall 1500ms ease-in forwards}
@keyframes flipy{0%{transform:rotateY(0)}50%{transform:rotateY(90deg)}100%{transform:rotateY(0)}}
.flipy{animation:flipy 340ms ease-in-out both;transform-style:preserve-3d}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.floaty{animation:floaty 3.4s ease-in-out infinite}
@keyframes dieroll{0%{transform:rotate(0) scale(1)}25%{transform:rotate(-16deg) scale(1.08)}50%{transform:rotate(14deg) scale(1.04)}75%{transform:rotate(-8deg) scale(1.02)}100%{transform:rotate(0) scale(1)}}
.dieroll{animation:dieroll 420ms ease-out}
@media (prefers-reduced-motion:reduce){.slam,.jolt,.fade,.deal,.turn,.swap,.pop,.confetti,.flipy,.floaty,.dieroll{animation:none!important}}
`;

/* ═══════════════════════════ app ═══════════════════════════ */
export default function App() {
  // Card face is a personal, per-device choice — kept out of the shared room so
  // each player sees their own deck. It lives above the game so every screen,
  // including the home preview, renders through the same provider. Both it and
  // each game's last-used house rules persist locally (see savePrefs).
  const [french, setFrench] = useState(false);
  const [savedRules, setSavedRules] = useState({});
  const [name, setName] = useState("");
  const [showScores, setShowScores] = useState(false); // live points/cards-taken, off by default
  const booted = useRef(false);
  useEffect(() => {
    (async () => {
      const p = await loadPrefs();
      if (!p) return;
      if (typeof p.french === "boolean") setFrench(p.french);
      if (p.rules && typeof p.rules === "object") setSavedRules(p.rules);
      if (typeof p.name === "string") setName(p.name);
      if (typeof p.showScores === "boolean") setShowScores(p.showScores);
    })();
  }, []);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    savePrefs({ french, rules: savedRules, name, showScores });
  }, [french, savedRules, name, showScores]);
  const setGameRules = (game, opts) => setSavedRules((r) => ({ ...r, [game]: opts }));
  return (
    <SuitCtx.Provider value={french}>
      <Game
        french={french}
        setFrench={setFrench}
        savedRules={savedRules}
        setGameRules={setGameRules}
        name={name}
        setName={setName}
        showScores={showScores}
        setShowScores={setShowScores}
      />
    </SuitCtx.Provider>
  );
}

function Game({ french, setFrench, savedRules, setGameRules, name, setName, showScores, setShowScores }) {
  const [screen, setScreen] = useState("home");
  const [codeIn, setCodeIn] = useState("");
  const [seat, setSeat] = useState("A");
  const [room, setRoom] = useState(null);
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState("waiting");
  const [pick, setPick] = useState(null);
  const [sound, setSound] = useState(true);
  const [jolt, setJolt] = useState(false);
  const [slamId, setSlamId] = useState(null);
  const [booting, setBooting] = useState(true);

  const roomRef = useRef(null);
  const netRef = useRef(null);
  const relayRef = useRef(false);
  const seenAnim = useRef(null);
  const soundRef = useRef(true);
  const seatRef = useRef("A");
  const typedName = useRef(false); // did the user type their name (vs it coming from prefs)?
  const deepJoined = useRef(false);
  const deepRef = useRef(undefined);
  if (deepRef.current === undefined) {
    try {
      const t = (new URLSearchParams(location.search).get("t") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      deepRef.current = t.length === 4 ? t : null;
    } catch {
      deepRef.current = null;
    }
  }
  roomRef.current = room;
  soundRef.current = sound;
  seatRef.current = seat;

  /* ── incoming state ── */
  const receive = useCallback((r) => {
    if (!r || !r.code) return;
    const cur = roomRef.current;
    if (cur && r.v <= cur.v) return;
    roomRef.current = r;
    setRoom(r);
    setPick(null);
    setLink("live");
  }, []);

  /* ── outgoing state ── */
  const publish = useCallback((next) => {
    const cur = roomRef.current;
    const out = { ...next, v: (cur ? cur.v : 0) + 1, ts: Date.now() };
    roomRef.current = out;
    setRoom(out);
    netRef.current?.send(out);
    if (!hasStore()) {
      try {
        const s = JSON.parse(sessionStorage.getItem(SESSION) || "{}");
        if (s.code === out.code) sessionStorage.setItem(SESSION, JSON.stringify({ ...s, room: out, ts: Date.now() }));
      } catch {}
    }
  }, []);

  /* ── animation trigger, local and remote ── */
  useEffect(() => {
    const a = room?.anim;
    if (!a || a.id === seenAnim.current) return;
    seenAnim.current = a.id;
    setSlamId(a.card || null);
    setJolt(true);
    slamSound(a.kind, soundRef.current);
    buzz(a.kind);
    const t1 = setTimeout(() => setJolt(false), 200);
    const t2 = setTimeout(() => setSlamId(null), 460);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [room?.anim?.id]);

  /* ── the finale, from this seat's point of view ── */
  const fgs = room?.gs;
  const decided = !!(fgs && fgs.done && (room.game === "scopa" ? fgs.matchDone : true));
  const winnerSeat =
    !fgs || !fgs.done
      ? null
      : room.game === "scopa"
      ? fgs.scores.A === fgs.scores.B
        ? null
        : fgs.scores.A > fgs.scores.B
        ? "A"
        : "B"
      : room.game === "ruba"
      ? fgs.summary?.win ?? null
      : fgs.win ?? null;
  const outcome = !decided ? null : winnerSeat == null ? "draw" : winnerSeat === seat ? "win" : "lose";
  const finaleFired = useRef(false);
  useEffect(() => {
    if (!decided) {
      finaleFired.current = false;
      return;
    }
    if (finaleFired.current) return;
    finaleFired.current = true;
    const id = setTimeout(() => {
      winSound(outcome, soundRef.current);
      buzz(outcome === "win" ? "scopa" : "lay");
    }, 220);
    return () => clearTimeout(id);
  }, [decided, outcome]);

  /* ── transports ── */
  const openStorage = useCallback(
    (code) => {
      let stop = false;
      const poll = async () => {
        if (stop) return;
        const r = await storeRead(code);
        if (r) receive(r);
      };
      const iv = setInterval(poll, 1200);
      poll();
      netRef.current = {
        send: (r) => storeWrite(r),
        hello: async (nm) => {
          const r = await storeRead(code);
          if (!r) return false;
          const next = { ...r, names: { ...r.names, B: nm }, v: r.v + 1, ts: Date.now() };
          roomRef.current = next;
          setRoom(next);
          await storeWrite(next);
          return true;
        },
        close: () => {
          stop = true;
          clearInterval(iv);
        },
      };
    },
    [receive]
  );

  const openRelay = useCallback(
    (code, host, nm) =>
      new Promise((resolve) => {
        let ws;
        try {
          ws = new WebSocket(relayUrl(code));
        } catch {
          return resolve(false);
        }
        let settled = false;
        const give = (ok) => {
          if (settled) return;
          settled = true;
          if (!ok)
            try {
              ws.close();
            } catch {}
          resolve(ok);
        };
        const timer = setTimeout(() => give(false), 2500);
        ws.onopen = () => {
          clearTimeout(timer);
          setLink("waiting");
          if (!host) ws.send(JSON.stringify({ type: "hello", name: nm || "Ospite" }));
          give(true);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          give(false);
        };
        ws.onclose = () => {
          clearTimeout(timer);
          if (settled) setLink("lost");
          give(false);
        };
        ws.onmessage = (e) => {
          let d;
          try {
            d = JSON.parse(e.data);
          } catch {
            return;
          }
          if (d.type === "state") receive(d.room);
          else if (d.type === "presence") setLink(d.n > 1 ? "live" : "waiting");
          else if (d.type === "hello" && seatRef.current === "A") {
            const cur = roomRef.current;
            if (cur) publish({ ...cur, names: { ...cur.names, B: d.name } });
          }
        };
        netRef.current = {
          send: (r) => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: "state", room: r }));
          },
          hello: async () => true,
          close: () => {
            try {
              ws.close();
            } catch {}
          },
        };
        relayRef.current = true;
      }),
    [receive, publish]
  );

  const openPeer = useCallback(
    async (code, host, nm) => {
      const Peer = await loadPeerJs();
      const id = "osteria-tavolo-" + code;
      const peer = new Peer(host ? id : undefined, { debug: 0 });
      let idRetries = 0;
      let conn = null;
      let queued = null;
      const wire = (c) => {
        conn = c;
        c.on("open", () => {
          setLink("live");
          if (!host) c.send({ hello: nm || "Ospite" });
          if (queued) {
            c.send(queued);
            queued = null;
          }
        });
        c.on("data", (d) => {
          if (d && d.hello !== undefined) {
            const cur = roomRef.current;
            if (cur) publish({ ...cur, names: { ...cur.names, B: d.hello } });
          } else receive(d);
        });
        c.on("close", () => setLink("lost"));
      };
      if (host) peer.on("connection", wire);
      else peer.on("open", () => wire(peer.connect(id, { reliable: true })));
      peer.on("error", (e) => {
        const t = String(e);
        if (t.includes("peer-unavailable")) {
          if (!host && idRetries++ < 4) {
            setLink("waiting");
            setTimeout(() => {
              try {
                wire(peer.connect(id, { reliable: true }));
              } catch {}
            }, 1200);
            return;
          }
          setMsg("Nessun tavolo risponde a questo codice.");
          setScreen("home");
        } else if (t.includes("unavailable-id") && host && idRetries++ < 4) {
          setLink("waiting");
          setTimeout(() => {
            try {
              peer.reconnect();
            } catch {}
          }, 1500);
        } else setLink("lost");
      });
      netRef.current = {
        send: (r) => {
          if (conn && conn.open) conn.send(r);
          else queued = r;
        },
        hello: async () => true,
        close: () => {
          try {
            peer.destroy();
          } catch {}
        },
      };
    },
    [receive, publish]
  );

  /* ── lifecycle ── */
  const openTable = async () => {
    const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
    const fresh = {
      code,
      v: 0,
      ts: Date.now(),
      names: { A: name.trim() || "Oste", B: null },
      status: "lobby",
      game: "scopa",
      opts: { ...GAMES.scopa.def, ...(savedRules.scopa || {}) },
      scores: showScores, // table rule: show live points/prese (seeded from host's saved default)
      gs: null,
      log: [],
      ev: null,
      anim: null,
    };
    setSeat("A");
    roomRef.current = fresh;
    setRoom(fresh);
    setLink("waiting");
    if (hasStore()) {
      await storeWrite(fresh);
      openStorage(code);
    } else if (await openRelay(code, true, name)) {
      netRef.current.send(fresh);
    } else await openPeer(code, true, name);
    saveSession({ code, seat: "A", name: name.trim() || "Oste", room: fresh });
    setScreen("table");
  };

  const joinTable = async (forceCode) => {
    const code = (typeof forceCode === "string" ? forceCode : codeIn).trim().toUpperCase();
    if (code.length !== 4) return setMsg("Il codice è di quattro lettere.");
    setSeat("B");
    setLink("waiting");
    if (hasStore()) {
      const r = await storeRead(code);
      if (!r) return setMsg(`Nessun tavolo al codice ${code}.`);
      roomRef.current = r;
      setRoom(r);
      openStorage(code);
      await netRef.current.hello(name.trim() || "Ospite");
    } else if (await openRelay(code, false, name.trim() || "Ospite")) {
      setTimeout(() => {
        if (!roomRef.current) {
          netRef.current?.close();
          setMsg(`Nessun tavolo al codice ${code}.`);
          setScreen("home");
        }
      }, 3500);
    } else {
      await openPeer(code, false, name.trim() || "Ospite");
    }
    saveSession({ code, seat: "B", name: name.trim() || "Ospite" });
    setScreen("table");
  };

  // Share the join link (native sheet where available, else clipboard).
  const share = async (code) => {
    const url = joinUrl(code);
    try {
      if (navigator.share) return await navigator.share({ title: "Osteria!", text: "Gioca a Osteria con me", url });
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Link copiato");
    } catch {
      setMsg(url);
    }
  };
  // NFC (Android/Chrome only): write the link to a tag, or read one to join.
  const writeNfc = async (code) => {
    if (!hasNfc()) return;
    try {
      await new window.NDEFReader().write({ records: [{ recordType: "url", data: joinUrl(code) }] });
      setMsg("Avvicina un tag NFC per scrivere il link");
    } catch {
      setMsg("NFC non disponibile");
    }
  };
  const readNfc = async () => {
    if (!hasNfc()) return;
    try {
      const r = new window.NDEFReader();
      await r.scan();
      setMsg("Avvicina il telefono al tag NFC…");
      r.onreading = (e) => {
        for (const rec of e.message.records) {
          try {
            const url = new TextDecoder().decode(rec.data);
            const t = (new URL(url, location.origin).searchParams.get("t") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
            if (t.length === 4) {
              setCodeIn(t);
              joinTable(t);
              return;
            }
          } catch {}
        }
      };
    } catch {
      setMsg("NFC non disponibile");
    }
  };

  const leave = () => {
    dropSession();
    netRef.current?.close();
    netRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setPick(null);
    setMsg("");
    setScreen("home");
  };

  useEffect(() => () => netRef.current?.close(), []);

  /* ── rejoin after a reload ───────────────────────────────────────── */
  useEffect(() => {
    let dead = false;
    (async () => {
      // A shared join link (?t=CODE) takes priority over restoring an old table.
      if (deepRef.current) {
        setCodeIn(deepRef.current);
        setBooting(false);
        return;
      }
      const s = await loadSession();
      if (dead) return;
      if (!s || !s.code || Date.now() - (s.ts || 0) > 6 * 3600e3) {
        await dropSession();
        setBooting(false);
        return;
      }
      setName(s.name || "");
      setSeat(s.seat || "A");
      setCodeIn(s.code);
      setLink("waiting");
      if (hasStore()) {
        const r = await storeRead(s.code);
        if (!r) {
          await dropSession();
          setBooting(false);
          return;
        }
        roomRef.current = r;
        setRoom(r);
        openStorage(s.code);
        setScreen("table");
      } else {
        if (s.room) {
          roomRef.current = s.room;
          setRoom(s.room);
        }
        const onRelay = await openRelay(s.code, s.seat === "A", s.name);
        if (!onRelay) await openPeer(s.code, s.seat === "A", s.name);
        if (s.seat === "A" && s.room) setTimeout(() => netRef.current?.send(roomRef.current), onRelay ? 200 : 900);
        setScreen("table");
      }
      setBooting(false);
    })();
    return () => {
      dead = true;
    };
  }, []);

  /* ── auto-join from a shared link once a saved name is available ──── */
  useEffect(() => {
    if (booting || !deepRef.current || deepJoined.current || room || screen !== "home") return;
    if (!name.trim() || typedName.current) return; // no saved name → user finishes by hand
    deepJoined.current = true;
    try {
      history.replaceState(null, "", location.pathname);
    } catch {}
    joinTable(deepRef.current);
  }, [booting, room, screen, name]);

  /* ── a drag at the top of the page must not reload the game ──────── */
  useEffect(() => {
    let y = 0;
    const start = (e) => {
      if (e.touches.length) y = e.touches[0].clientY;
    };
    const move = (e) => {
      if (!e.touches.length || !e.cancelable) return;
      const el = document.scrollingElement || document.documentElement;
      if (el.scrollTop <= 0 && e.touches[0].clientY - y > 0) e.preventDefault();
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
    };
  }, []);

  /* ── and neither should an accidental refresh, unwarned ──────────── */
  useEffect(() => {
    const live = room?.status === "play" && room?.gs && !room.gs.done;
    if (!live) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [room?.status, room?.gs?.done]);

  /* ── moves ── */
  const commit = (res) => {
    if (!res) return;
    // Store the move as a structured event, not a pre-formatted string, so each
    // player's screen renders it with their own deck's nomenclature.
    publish({
      ...room,
      gs: res.g,
      ev: res.ev ? { seat, ...res.ev } : null,
      anim: { id: uid(), kind: res.kind, card: res.card?.id, seat },
    });
  };

  // The host picks the game and its house rules in the lobby, before anything is
  // dealt; both are synced so the guest sees the table being set. Dealing just
  // flips the room to play with whatever is already staged in room.game/opts.
  const pickGame = (game) => publish({ ...room, game, opts: { ...GAMES[game].def, ...(savedRules[game] || {}) } });

  // Deal a game from an ordered deck (either RNG or the one the players shuffled
  // and cut). `cont` carries running scores/tally into the next game.
  const dealGame = (game, o, dealer, cont, deck) =>
    game === "scopa"
      ? dealScopa(dealer, cont?.scores || null, o, deck)
      : game === "ruba"
      ? dealRuba(dealer, cont?.tally || null, deck)
      : game === "briscola"
      ? dealBriscola(dealer, cont?.tally || null, deck)
      : game === "perudo"
      ? dealPerudo(dealer, cont?.tally || null)
      : game === "yahtzee"
      ? dealYahtzee(dealer, cont?.tally || null)
      : dealCamicia(cont?.tally || null, deck);

  const dealNow = (gsNew) => publish({ ...room, status: "play", gs: gsNew, log: [], ev: null, anim: null });

  // Enter the shuffle-and-cut ritual with a fresh RNG deck; the dealer shuffles,
  // the other player cuts, then the cut hand deals from the result.
  const beginPrepare = (dealer, cont) =>
    publish({ ...room, status: "prep", prep: { deck: shuffle(makeDeck()), step: "shuffle", shuffles: 0, dealer, cont: cont || null } });

  const shuffleTap = (seed) =>
    publish({ ...room, prep: { ...room.prep, deck: shuffleWith(room.prep.deck, seed), shuffles: room.prep.shuffles + 1 } });
  const shuffleDone = () => publish({ ...room, prep: { ...room.prep, step: "cut" } });
  const cutAndDeal = (at) => {
    const p = room.prep;
    const gsNew = dealGame(room.game, room.opts, p.dealer, p.cont, cutDeck(p.deck, at));
    publish({ ...room, status: "play", gs: gsNew, prep: null, log: [], ev: null, anim: null });
  };

  const start = () => (isCard(room.game) ? beginPrepare("A", null) : dealNow(dealGame(room.game, room.opts, "A", null)));
  const again = () => {
    const g = room.gs;
    if (room.game === "scopa" && !g.matchDone) dealNow(dealGame("scopa", room.opts, other(g.dealer), { scores: g.scores }));
    else if (room.game === "scopa") beginPrepare("A", null);
    else if (isCard(room.game)) beginPrepare(other(g.dealer), { tally: g.tally });
    else dealNow(dealGame(room.game, room.opts, g.win ? other(g.win) : "A", { tally: g.tally })); // dice
  };

  const setOpt = (k, val) => {
    const opts = { ...room.opts, [k]: val };
    publish({ ...room, opts });
    setGameRules(room.game, opts); // remember this game's rules for next time
  };
  // Show-points is a table rule: the host sets it, both players get it. The host's
  // choice is also saved locally so the next table starts the same way.
  const setScores = (val) => {
    publish({ ...room, scores: val });
    setShowScores(val);
  };

  /* ═════════ boot ═════════ */
  if (booting)
    return (
      <Frame jolt={false}>
        <div style={{ paddingTop: 90, textAlign: "center" }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <Back size="sm" />
            <Back size="sm" />
          </div>
          <Micro style={{ marginTop: 16 }}>Distribuzione…</Micro>
        </div>
      </Frame>
    );

  /* ═════════ home ═════════ */
  if (screen === "home")
    return (
      <Frame jolt={false}>
        <div
          className="fade"
          style={{
            minHeight: "calc(100dvh - 40px)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingBottom: 12,
          }}
        >
          {/* wordmark — the one thing the eye lands on */}
          <div style={{ marginBottom: 2 }}>
            <HomeDeck />
          </div>
          <h1
            style={{
              fontFamily: BRAND,
              fontSize: "clamp(56px, 19vw, 104px)",
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: "-0.01em",
              textAlign: "center",
              margin: "10px 0 0",
              whiteSpace: "nowrap",
            }}
          >
            Osteria<span style={{ color: "#A5342F", display: "inline-block", transform: "rotate(7deg)" }}>!</span>
          </h1>
          <Micro style={{ textAlign: "center", marginTop: 8 }}>Due giocatori · due telefoni · un codice</Micro>

          <div style={{ marginTop: 26 }}>
            <input
              value={name}
              onChange={(e) => {
                typedName.current = true;
                setName(e.target.value);
              }}
              placeholder="Il tuo nome"
              maxLength={14}
              style={{ ...field, fontFamily: BRAND, fontSize: 18, textAlign: "center", padding: "14px 13px" }}
            />
            <div style={{ marginTop: 10 }}>
              <Button full onClick={openTable}>
                Apri un tavolo
              </Button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 2px" }}>
              <div style={{ flex: 1, height: 1, background: T.line }} />
              <Micro>oppure</Micro>
              <div style={{ flex: 1, height: 1, background: T.line }} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={codeIn}
                onChange={(e) => setCodeIn(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                placeholder="CODICE"
                style={{ ...field, textAlign: "center", letterSpacing: "0.4em", fontFamily: "ui-monospace, monospace", fontSize: 18, minWidth: 0 }}
              />
              <Button kind="line" onClick={() => joinTable()}>
                Entra
              </Button>
            </div>
            {hasNfc() && (
              <button onClick={readNfc} style={{ ...plain, display: "block", margin: "12px auto 0", textAlign: "center" }}>
                ᯤ Leggi un tag NFC
              </button>
            )}
            {msg && <p style={{ color: T.ink, fontSize: 13, marginTop: 12, textAlign: "center" }}>{msg}</p>}
          </div>
        </div>
      </Frame>
    );

  if (!room)
    return (
      <Frame jolt={false}>
        <div className="fade" style={{ paddingTop: 60, textAlign: "center" }}>
          <Micro>Connessione a {codeIn.toUpperCase()}</Micro>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 18 }}>
            <Back size="sm" />
            <Back size="sm" />
          </div>
          <div style={{ marginTop: 24 }}>
            <Button kind="line" onClick={leave}>
              Indietro
            </Button>
          </div>
        </div>
      </Frame>
    );
  const opp = other(seat);
  const seated = !!room.names.B;

  /* ═════════ lobby — pick the game and set the rules before dealing ═════════ */
  if (room.status === "lobby") {
    const host = seat === "A";
    const g = GAMES[room.game];
    return (
      <Frame jolt={false}>
        <Head room={room} link={link} onLeave={leave} sound={sound} setSound={setSound} title="Al tavolo" />
        <div className="fade">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <Micro>Codice tavolo</Micro>
              <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                {room.code.split("").map((ch, i) => (
                  <div key={i} style={{ ...codeTile, width: 34, height: 44, fontSize: 19 }}>
                    {ch}
                  </div>
                ))}
              </div>
            </div>
            <Micro style={{ textAlign: "right", maxWidth: 128, lineHeight: 1.6 }}>
              {seated ? `${room.names.B} è al tavolo` : "In attesa del secondo giocatore…"}
            </Micro>
          </div>

          {!seated && (
            <div
              className="fade"
              style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 14, padding: 12, border: `1px solid ${T.line}`, borderRadius: 12 }}
            >
              <QRCode text={joinUrl(room.code)} size={116} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: BRAND, fontSize: 15, fontWeight: 600 }}>Inquadra per entrare</div>
                <Micro style={{ marginTop: 4, textTransform: "none", letterSpacing: 0, fontSize: 12, lineHeight: 1.5 }}>
                  L’altro scansiona il codice — niente da digitare.
                </Micro>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button onClick={() => share(room.code)} style={sharePill}>
                    Condividi link
                  </button>
                  {hasNfc() && (
                    <button onClick={() => writeNfc(room.code)} style={sharePill}>
                      Tag NFC
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {!seated && msg && <Micro style={{ marginTop: 8, textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{msg}</Micro>}

          <Rule />

          <Micro>Gioco</Micro>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            {Object.entries(GAMES).map(([k, gm]) => {
              const on = k === room.game;
              return (
                <button
                  key={k}
                  onClick={host ? () => pickGame(k) : undefined}
                  disabled={!host}
                  style={{
                    textAlign: "left",
                    border: `1.5px solid ${on ? T.ink : T.line}`,
                    background: on ? T.ink : "transparent",
                    color: on ? T.bg : T.ink,
                    borderRadius: 12,
                    padding: "11px 13px",
                    cursor: host ? "pointer" : "default",
                    transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div style={{ fontFamily: BRAND, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{gm.name}</div>
                  <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", opacity: 0.7, marginTop: 2 }}>{gm.tag}</div>
                </button>
              );
            })}
          </div>
          <p style={{ color: T.ink60, fontSize: 13, lineHeight: 1.45, margin: "12px 0 0" }}>{g.line}</p>

          {g.opts.length > 0 && (
            <>
              <Micro style={{ marginTop: 20 }}>Regole della casa{host ? "" : " · le sceglie l’host"}</Micro>
              <RuleChips conf={g} opts={room.opts} setOpt={host ? setOpt : null} />
            </>
          )}

          {isCard(room.game) && (
            <>
              <Micro style={{ marginTop: 20 }}>Punti e prese{host ? "" : " · li decide l’host"}</Micro>
              <Segmented
                options={[
                  { v: false, label: "Nascondi" },
                  { v: true, label: "Mostra" },
                ]}
                value={!!room.scores}
                onPick={host ? setScores : null}
                style={{ marginTop: 8 }}
              />

              <Micro style={{ marginTop: 20 }}>Carte · sul tuo telefono</Micro>
              <FaceToggle french={french} setFrench={setFrench} />
            </>
          )}

          <div style={{ marginTop: 24 }}>
            {host ? (
              <Button full disabled={!seated} onClick={start}>
                {seated ? `Distribuisci · ${g.name}` : "In attesa del secondo giocatore…"}
              </Button>
            ) : (
              <Micro>{room.names.A} sta preparando il tavolo — un attimo.</Micro>
            )}
          </div>
        </div>
      </Frame>
    );
  }

  /* ═════════ shuffle & cut ═════════ */
  if (room.status === "prep" && room.prep)
    return (
      <Frame jolt={false}>
        <Head room={room} link={link} onLeave={leave} sound={sound} setSound={setSound} title="Prepara il mazzo" />
        <Prepare
          room={room}
          seat={seat}
          shuffleTap={shuffleTap}
          shuffleDone={shuffleDone}
          cutAndDeal={cutAndDeal}
        />
      </Frame>
    );

  /* ═════════ table ═════════ */
  const gs = room.gs;
  const mine = gs.turn === seat && !gs.done;
  const conf = GAMES[room.game];

  return (
    <Frame jolt={jolt}>
      <Head room={room} link={link} onLeave={leave} sound={sound} setSound={setSound} title={conf.name} />

      {room.game === "camicia" ? (
        <Camicia room={room} gs={gs} seat={seat} mine={mine} slamId={slamId} commit={commit} showScores={!!room.scores} />
      ) : room.game === "briscola" ? (
        <Briscola room={room} gs={gs} seat={seat} opp={opp} mine={mine} slamId={slamId} commit={commit} showScores={!!room.scores} />
      ) : room.game === "perudo" ? (
        <Perudo room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "yahtzee" ? (
        <Yahtzee room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : (
        <Board
          room={room}
          gs={gs}
          seat={seat}
          opp={opp}
          mine={mine}
          slamId={slamId}
          pick={pick}
          setPick={setPick}
          commit={commit}
          showScores={!!room.scores}
        />
      )}

      {room.ev && !gs.done && isCard(room.game) && (
        <p style={{ color: T.ink60, fontSize: 12, textAlign: "center", marginTop: 14, minHeight: 16 }}>
          {who(room, room.ev.seat)} {describe(room.ev, french)}
        </p>
      )}

      {gs.done && (
        <div className="fade" style={{ borderTop: `1px solid ${T.line}`, marginTop: 14, paddingTop: decided ? 6 : 14 }}>
          {decided && <Finale outcome={outcome} />}
          <Summary room={room} gs={gs} />
          {seat === "A" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button full onClick={again}>
                {room.game === "scopa" && !gs.matchDone ? "Prossima mano" : "Gioca ancora"}
              </Button>
              <Button kind="line" onClick={() => publish({ ...room, status: "lobby", gs: null, log: [], ev: null })}>
                Giochi
              </Button>
            </div>
          ) : (
            <Micro style={{ marginTop: 14, textAlign: "center" }}>distribuisce {room.names.A}</Micro>
          )}
        </div>
      )}
    </Frame>
  );
}

/* ═══════════════════════════ pieces ═══════════════════════════ */
const field = {
  width: "100%",
  background: "transparent",
  border: `1px solid ${T.line}`,
  borderRadius: 4,
  padding: "12px 13px",
  fontSize: 15,
  color: T.ink,
  outline: "none",
};
const codeTile = {
  width: 42,
  height: 54,
  background: T.paper,
  border: `1px solid ${T.line}`,
  borderRadius: 4,
  display: "grid",
  placeItems: "center",
  fontFamily: "ui-monospace, monospace",
  fontSize: 22,
  fontWeight: 600,
};

function Frame({ children, jolt }) {
  return (
    <div className="app" style={{ background: T.bg, color: T.ink, overscrollBehavior: "none", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{CSS}</style>
      <div className={jolt ? "jolt" : ""} style={{ maxWidth: 480, margin: "0 auto", padding: "14px 16px 24px" }}>
        {children}
      </div>
    </div>
  );
}

function Head({ room, link, onLeave, title, sound, setSound }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 12,
        borderBottom: `1px solid ${T.line}`,
        marginBottom: 16,
      }}
    >
      <div>
        <Micro>
          {room.code} · {link === "live" ? "connesso" : link === "waiting" ? "in attesa" : "disconnesso"}
        </Micro>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2, fontFamily: BRAND }}>{title}</div>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {link === "lost" && (
          <button onClick={() => window.location.reload()} style={{ ...plain, color: T.ink, fontWeight: 700 }}>
            Riconnetti
          </button>
        )}
        <button onClick={() => setSound(!sound)} style={plain}>
          {sound ? "Audio on" : "Audio off"}
        </button>
        <button onClick={onLeave} style={plain}>
          Esci
        </button>
      </div>
    </div>
  );
}
const plain = {
  background: "none",
  border: "none",
  padding: 0,
  color: T.ink60,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "ui-monospace, monospace",
};
const sharePill = {
  border: `1px solid ${T.ink}`,
  background: T.ink,
  color: T.bg,
  borderRadius: 999,
  padding: "7px 13px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: BRAND,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

/* A segmented control: the whole row is one pill, the active cell is inked in.
   onPick null makes it a read-only display (what the guest sees). */
function Segmented({ options, value, onPick, style }) {
  return (
    <div
      style={{
        display: "flex",
        border: `1px solid ${T.line}`,
        borderRadius: 999,
        padding: 3,
        gap: 3,
        ...style,
      }}
    >
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            onClick={onPick ? () => onPick(o.v) : undefined}
            disabled={!onPick}
            style={{
              flex: 1,
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              border: "none",
              background: on ? T.ink : "transparent",
              color: on ? T.bg : T.ink60,
              borderRadius: 999,
              padding: "8px 6px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.01em",
              cursor: onPick ? "pointer" : "default",
              transition: "background 180ms ease, color 180ms ease",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* House-rule chips. setOpt null → read-only (the guest's view). */
function RuleChips({ conf, opts, setOpt }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {conf.opts.map((o) => {
        const cur = opts[o.k];
        const i = o.cycle.indexOf(cur);
        const next = o.cycle[(i + 1) % o.cycle.length];
        const on = cur === true;
        return (
          <button
            key={o.k}
            onClick={setOpt ? () => setOpt(o.k, next) : undefined}
            disabled={!setOpt}
            style={{
              border: `1px solid ${on ? T.ink : T.line}`,
              background: on ? T.ink : "transparent",
              color: on ? T.bg : T.ink60,
              borderRadius: 999,
              padding: "7px 12px",
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              cursor: setOpt ? "pointer" : "default",
              transition: "background 180ms ease, color 180ms ease, border-color 180ms ease",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {o.label}
            {typeof cur === "number" ? ` ${cur}` : ""}
          </button>
        );
      })}
    </div>
  );
}

/* Personal deck-face switch. Napoletane (Italian suits) or Francesi (♦♥♠♣). */
function FaceToggle({ french, setFrench }) {
  return (
    <Segmented
      options={[
        { v: false, label: "Napoletane" },
        { v: true, label: "Francesi ♦♥♠♣" },
      ]}
      value={french}
      onPick={(v) => setFrench(v)}
      style={{ marginTop: 8 }}
    />
  );
}

const joinUrl = (code) => (typeof location !== "undefined" ? location.origin : "") + "/?t=" + code;
const hasNfc = () => typeof window !== "undefined" && "NDEFReader" in window;

/* The join link as a scannable QR, rendered as inline SVG (no external service). */
function QRCode({ text, size = 138 }) {
  let q;
  try {
    q = qrEncode(text);
  } catch {
    return null;
  }
  const n = q.size;
  const quiet = 4;
  const total = n + quiet * 2;
  const cell = size / total;
  const rects = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (q.matrix[r][c])
        rects.push(<rect key={r * n + c} x={(c + quiet) * cell} y={(r + quiet) * cell} width={cell + 0.6} height={cell + 0.6} />);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" style={{ borderRadius: 10, display: "block" }}>
      <rect width={size} height={size} fill="#fff" />
      <g fill="#121212">{rects}</g>
    </svg>
  );
}

const rnd = (n) => Math.floor(Math.random() * n);
const randCard = () => {
  const s = ["D", "C", "S", "B"][rnd(4)];
  return { id: `${s}${1 + rnd(10)}-${uid()}`, s, v: 1 + rnd(10) };
};
/* The home flourish: four cards dealt fresh on every visit, each flipping to a
   new card when you tap it. Pure decoration, so it lives entirely in local state. */
function HomeDeck() {
  const [cards, setCards] = useState(() => [0, 1, 2, 3].map(() => randCard()));
  const [spin, setSpin] = useState([0, 0, 0, 0]);
  const flip = (i) => {
    setSpin((s) => s.map((x, j) => (j === i ? x + 1 : x)));
    setTimeout(() => setCards((cs) => cs.map((c, j) => (j === i ? randCard() : c))), 170);
  };
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 7, perspective: 640 }}>
      {cards.map((c, i) => (
        <div key={`${i}-${spin[i]}`} className="flipy">
          <Card card={c} size="sm" rot={(i - 1.5) * 8} onClick={() => flip(i)} />
        </div>
      ))}
    </div>
  );
}

/* ── dice ── */
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};
function Die({ v, size = 46, hidden, hi, on, onClick, roll }) {
  const pos = (i) => ((i + 0.5) / 3) * size;
  const pipR = size * 0.078;
  return (
    <div
      onClick={onClick}
      className={roll ? "dieroll" : ""}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: hidden ? T.ink : on ? T.ink : "#fff",
        border: `1px solid ${hi ? "#B8862B" : hidden || on ? T.ink : T.line}`,
        boxShadow: "0 2px 6px rgba(18,18,18,0.14)",
        position: "relative",
        flexShrink: 0,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {!hidden &&
        (PIPS[v] || []).map(([r, c], k) => (
          <span
            key={k}
            style={{
              position: "absolute",
              width: pipR * 2,
              height: pipR * 2,
              borderRadius: "50%",
              background: hi ? "#B8862B" : on ? "#fff" : T.ink,
              left: pos(c) - pipR,
              top: pos(r) - pipR,
            }}
          />
        ))}
    </div>
  );
}
async function requestMotion() {
  try {
    const D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === "function") return (await D.requestPermission()) === "granted";
    return typeof window !== "undefined" && "ondevicemotion" in window;
  } catch {
    return false;
  }
}
function useShake(onShake, active) {
  const cb = useRef(onShake);
  cb.current = onShake;
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let last = 0,
      px = null,
      py = null,
      pz = null;
    const h = (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      if (px != null) {
        const d = Math.abs((a.x || 0) - px) + Math.abs((a.y || 0) - py) + Math.abs((a.z || 0) - pz);
        const now = Date.now();
        if (d > 26 && now - last > 800) {
          last = now;
          cb.current();
        }
      }
      px = a.x || 0;
      py = a.y || 0;
      pz = a.z || 0;
    };
    window.addEventListener("devicemotion", h);
    return () => window.removeEventListener("devicemotion", h);
  }, [active]);
}

/* ── scopa / rubamazzo board ── */
function Board({ room, gs, seat, opp, mine, slamId, pick, setPick, commit, showScores }) {
  const isScopa = room.game === "scopa";
  const o = room.opts;

  const play = (card) => {
    if (!mine) return;
    const opts = isScopa ? scopaOptions(card, gs.table, o) : rubaOptions(card, gs, seat, o);
    if (opts.length === 0) commit(isScopa ? scopaPlay(gs, seat, card.id, null, o) : rubaPlay(gs, seat, card.id, null));
    else if (opts.length === 1)
      commit(isScopa ? scopaPlay(gs, seat, card.id, opts[0], o) : rubaPlay(gs, seat, card.id, opts[0]));
    else setPick({ card, opts });
  };
  const choose = (opt) => {
    commit(isScopa ? scopaPlay(gs, seat, pick.card.id, opt, o) : rubaPlay(gs, seat, pick.card.id, opt));
    setPick(null);
  };

  const tally = isScopa ? gs.scores : { A: gs.piles.A.length, B: gs.piles.B.length };
  const unit = isScopa ? "punti" : "carte";
  const a = room.anim;
  const taken = a && a.kind !== "lay" && a.card ? { id: a.card, s: a.card[0], v: +a.card.slice(1) } : null;

  return (
    <div>
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>{who(room, opp)}</div>
          {showScores && (
            <Micro style={{ marginTop: 2 }}>
              {tally[opp]} {unit}
              {isScopa && gs.scope[opp] ? ` · ${gs.scope[opp]} scopa` : ""}
            </Micro>
          )}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {gs.hands[opp].map((c) => (
            <Back key={c.id} size="xs" />
          ))}
        </div>
      </div>

      {/* table */}
      <div style={{ margin: "18px 0", minHeight: 108 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <Micro>Tavolo</Micro>
          <Micro>{gs.deck.length} nel mazzo</Micro>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", minHeight: 78 }}>
          {gs.table.length === 0 && (
            <Micro style={{ padding: "28px 0" }}>tavolo pulito</Micro>
          )}
          {gs.table.map((c) => (
            <Card
              key={c.id}
              card={c}
              size="md"
              enter
              slam={slamId === c.id}
              active={pick && pick.opts.some((x) => (isScopa ? x : x.ids || []).includes(c.id))}
            />
          ))}
        </div>
      </div>

      {/* piles */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <PileView room={room} gs={gs} seat={opp} label="sua pila" faceUp={!isScopa} slamId={slamId} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {taken && <Card card={taken} size="sm" rot={0} slam={slamId === taken.id} />}
          <div
            className={!gs.done && mine ? "turn" : ""}
            style={{
              fontFamily: BRAND,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "5px 13px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              background: !gs.done && mine ? T.ink : "transparent",
              color: !gs.done && mine ? T.bg : T.ink60,
              border: `1px solid ${!gs.done && mine ? T.ink : T.line}`,
            }}
          >
            {gs.done ? "mano finita" : mine ? "tocca a te" : "aspetta"}
          </div>
        </div>
        <PileView room={room} gs={gs} seat={seat} label="tua pila" faceUp={!isScopa} slamId={slamId} right />
      </div>

      {/* choice */}
      {pick && (
        <div className="fade" style={{ border: `1px solid ${T.ink}`, borderRadius: 10, padding: 13, marginTop: 16 }}>
          <Micro>{isScopa ? "Scegli la presa" : "Scegli"}</Micro>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {pick.opts.map((opt, i) => {
              const ids = isScopa ? opt : opt.ids;
              const steal = !isScopa && opt.type === "steal";
              return (
                <button
                  key={i}
                  onClick={() => choose(opt)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    border: `1px solid ${T.line}`,
                    background: T.paper,
                    borderRadius: 8,
                    padding: 9,
                    cursor: "pointer",
                  }}
                >
                  {steal ? (
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      Ruba il mazzo — {gs.piles[other(seat)].length} carte
                    </span>
                  ) : (
                    gs.table
                      .filter((c) => ids.includes(c.id))
                      .map((c) => <Card key={c.id} card={c} size="sm" rot={0} />)
                  )}
                </button>
              );
            })}
            <button onClick={() => setPick(null)} style={{ ...plain, textAlign: "left", marginTop: 2 }}>
              annulla
            </button>
          </div>
        </div>
      )}

      {/* hand */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>
            {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
          </div>
          {showScores && (
            <Micro>
              {tally[seat]} {unit}
              {isScopa && gs.scope[seat] ? ` · ${gs.scope[seat]} scopa` : ""}
            </Micro>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minHeight: 96 }}>
          {gs.hands[seat].map((c) => (
            <Card
              key={c.id}
              card={c}
              size="lg"
              rot={0}
              enter
              dim={!mine}
              active={pick?.card.id === c.id}
              onClick={mine && !pick ? () => play(c) : undefined}
            />
          ))}
          {gs.hands[seat].length === 0 && <Micro style={{ alignSelf: "center" }}>mano vuota</Micro>}
        </div>
      </div>
    </div>
  );
}

function PileView({ room, gs, seat, label, faceUp, slamId, right }) {
  const pile = gs.piles[seat];
  const top = pile[pile.length - 1];
  return (
    <div style={{ textAlign: right ? "right" : "left" }}>
      <div style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start", alignItems: "flex-start" }}>
        {faceUp ? (
          <Deck3D n={pile.length} top={top} faceUp size="sm" slamId={slamId} live />
        ) : (
          <Stack n={pile.length} top={top} faceUp={faceUp} size="sm" right={right} slamId={slamId} />
        )}
      </div>
      <Micro style={{ marginTop: 5 }}>{label}</Micro>
    </div>
  );
}

/* ── straccia camicia ── */
function Camicia({ room, gs, seat, mine, slamId, commit, showScores }) {
  const opp = other(seat);
  const shown = gs.center.slice(-5);
  const attack = room.opts.intl ? "A 4 · R 3 · C 2 · F 1" : "A 1 · 2 due · 3 tre";
  const flip = () => {
    if (mine && !gs.done) commit(camiciaFlip(gs, seat, room.opts));
  };
  const label = gs.done ? "FINE" : !mine ? "ASPETTA" : gs.debt > 0 ? `PAGA ${gs.debt}` : "GIRA";

  // Slide the deck up to slam. Tapping still works (a near-zero swipe), and the
  // pile is collected automatically when the exchange is won — no take gesture.
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);
  const pointY = (e) => (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY);
  const onStart = (e) => {
    if (!mine || gs.done) return;
    startY.current = pointY(e);
  };
  const onMove = (e) => {
    if (startY.current == null) return;
    setDragY(Math.max(-70, Math.min(0, pointY(e) - startY.current)));
  };
  const onEnd = (e) => {
    if (startY.current == null) return;
    if (e.cancelable) e.preventDefault();
    const moved = dragY;
    startY.current = null;
    setDragY(0);
    if (mine && !gs.done && (moved < -36 || Math.abs(moved) < 8)) flip();
  };

  return (
    <div>
      {/* opponent packet */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>{who(room, opp)}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <Micro>{gs.decks[opp].length}</Micro>
          <Deck3D n={gs.decks[opp].length} faceUp={false} size="xs" live />
        </div>
      </div>

      {/* the middle */}
      <div style={{ margin: "16px 0", minHeight: 148, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 96 }}>
          {shown.length === 0 && <Micro>niente in mezzo</Micro>}
          {shown.map((c, i) => (
            <div key={c.id} style={{ marginLeft: i ? -26 : 0, zIndex: i }}>
              <Card
                card={c}
                size={i === shown.length - 1 ? "lg" : "sm"}
                dim={i !== shown.length - 1}
                enter={i === shown.length - 1}
                slam={slamId === c.id}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <div
            key={`${gs.done}-${gs.debt}-${gs.turn}`}
            className="swap"
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            {gs.done
              ? gs.win
                ? `${who(room, gs.win)} prende tutto`
                : "Bloccati in un ciclo — pareggio"
              : gs.debt > 0
              ? `${who(room, gs.turn)} deve ${gs.debt}`
              : `gira ${who(room, gs.turn)}`}
          </div>
          <Micro style={{ marginTop: 5 }}>
            {gs.center.length} in mezzo · {attack}
          </Micro>
        </div>
      </div>

      {/* your packet + slide-up dock */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>
          {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
        </div>
        <Micro>{gs.decks[seat].length} carte</Micro>
      </div>

      <div
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onMouseDown={onStart}
        onMouseMove={onMove}
        onMouseUp={onEnd}
        style={{
          position: "relative",
          height: 152,
          borderRadius: 8,
          border: `1px dashed ${mine ? T.ink30 : T.line}`,
          background: mine ? "rgba(18,18,18,0.02)" : "transparent",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: "0 0 12px",
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: mine && !gs.done ? "grab" : "default",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Micro style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center" }}>
          {gs.done ? "mano finita" : mine ? "trascina il mazzo in su per giocare" : "tocca all’altro"}
        </Micro>
        <div
          style={{
            transform: `translateY(${dragY}px)`,
            transition: startY.current == null ? "transform 220ms cubic-bezier(.2,.9,.25,1)" : "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            opacity: gs.decks[seat].length ? 1 : 0.4,
          }}
        >
          <Deck3D n={gs.decks[seat].length} faceUp={false} size="md" live />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.16em", color: mine && !gs.done ? T.ink : T.ink30 }}>
            {label}
          </div>
        </div>
      </div>

      {showScores && (
        <Micro style={{ textAlign: "center", marginTop: 10 }}>
          mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
        </Micro>
      )}
    </div>
  );
}

/* ── briscola ── */
function Briscola({ room, gs, seat, opp, mine, slamId, commit, showScores }) {
  const french = useContext(SuitCtx);
  const play = (card) => {
    if (mine) commit(briscolaPlay(gs, seat, card.id));
  };
  const a = room.anim;
  const played = a && a.card ? { id: a.card, s: a.card[0], v: +a.card.slice(1) } : null;
  const nameRow = (s, you) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>
        {who(room, s)}
        {you && <span style={{ color: T.ink30, fontWeight: 400 }}> tu</span>}
      </div>
      {showScores && <Micro>{brisPoints(gs.piles[s])} punti</Micro>}
    </div>
  );

  return (
    <div>
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {nameRow(opp, false)}
        <div style={{ display: "flex", gap: 3 }}>
          {gs.hands[opp].map((c) => (
            <Back key={c.id} size="xs" />
          ))}
        </div>
      </div>

      {/* trump + stock, and the trick in play */}
      <div style={{ position: "relative", minHeight: 168, margin: "16px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* briscola + stock, pinned left */}
        <div style={{ position: "absolute", left: 0, top: 8, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          {gs.deck.length > 0 ? (
            <div style={{ position: "relative", width: 74, height: 60 }}>
              <div style={{ position: "absolute", left: 20, top: 6, transform: "rotate(90deg)" }}>
                <Card card={gs.briscola} size="xs" rot={0} />
              </div>
              <div style={{ position: "absolute", left: 0, top: 0 }}>
                <Deck3D n={gs.deck.length} faceUp={false} size="xs" />
              </div>
            </div>
          ) : (
            <div style={{ width: 40, height: 40, border: `1px solid ${T.line}`, borderRadius: 8, display: "grid", placeItems: "center" }}>
              <Pip suit={gs.trump} size={22} />
            </div>
          )}
          <Micro>{gs.deck.length > 0 ? `${gs.deck.length} nel mazzo` : "mazzo finito"}</Micro>
        </div>

        {/* the trick */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {gs.lead ? (
            <Card card={gs.lead.card} size="lg" rot={-3} slam={slamId === gs.lead.card.id} enter />
          ) : played && slamId === played.id ? (
            <Card card={played} size="lg" rot={3} slam />
          ) : (
            <Micro>{mine ? "apri la mano" : `gioca ${who(room, gs.turn)}`}</Micro>
          )}
        </div>
      </div>

      {/* turn */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <div
          className={!gs.done && mine ? "turn" : ""}
          style={{
            fontFamily: BRAND,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "5px 13px",
            borderRadius: 999,
            background: !gs.done && mine ? T.ink : "transparent",
            color: !gs.done && mine ? T.bg : T.ink60,
            border: `1px solid ${!gs.done && mine ? T.ink : T.line}`,
          }}
        >
          {gs.done ? "mano finita" : mine ? (gs.lead ? "rispondi" : "gioca") : "aspetta"}
        </div>
      </div>

      {/* your hand */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          {nameRow(seat, true)}
          <Micro>briscola {suitName(gs.trump, french)}</Micro>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minHeight: 108 }}>
          {gs.hands[seat].map((c) => (
            <Card key={c.id} card={c} size="lg" rot={0} enter dim={!mine} onClick={mine ? () => play(c) : undefined} />
          ))}
          {gs.hands[seat].length === 0 && <Micro style={{ alignSelf: "center" }}>mano vuota</Micro>}
        </div>
      </div>
    </div>
  );
}

/* ── perudo ── */
function Perudo({ room, gs, seat, mine, commit }) {
  const opp = other(seat);
  const [motionOn, setMotionOn] = useState(false);
  const [bidQty, setBidQty] = useState(1);
  const [bidFace, setBidFace] = useState(2);
  const rolled = gs.rolled[seat];
  const canRoll = gs.phase === "roll" && mine && !rolled;
  const doRoll = () => {
    if (gs.phase === "roll" && gs.turn === seat && !gs.rolled[seat]) commit(perudoRoll(gs, seat));
  };
  useShake(doRoll, motionOn && canRoll);
  const tapRoll = async () => {
    if (!motionOn) setMotionOn(await requestMotion());
    doRoll();
  };
  useEffect(() => {
    if (gs.phase === "bid" && gs.turn === seat) {
      const m = !gs.bid ? { q: 1, f: 2 } : gs.bid.face < 6 ? { q: gs.bid.qty, f: gs.bid.face + 1 } : { q: gs.bid.qty + 1, f: 2 };
      setBidQty(m.q);
      setBidFace(m.f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs.phase, gs.turn, gs.bid?.qty, gs.bid?.face]);

  const legal = bidValid(gs.bid, bidQty, bidFace);
  const total = gs.counts.A + gs.counts.B;

  return (
    <div>
      {/* opponent packet */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, opp)}</div>
        <div style={{ display: "flex", gap: 4 }}>
          {Array.from({ length: gs.counts[opp] }).map((_, i) => (
            <Die key={i} hidden size={26} />
          ))}
        </div>
      </div>

      {/* the standing bid / reveal / prompt */}
      <div style={{ minHeight: 150, margin: "16px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {gs.phase === "reveal" ? (
          <div style={{ textAlign: "center", width: "100%" }}>
            <div className="pop" style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: gs.reveal.loser === seat ? T.ink30 : "#B8862B" }}>
              {gs.reveal.actual >= gs.reveal.qty ? "C’erano!" : "Bluff!"}
            </div>
            <Micro style={{ marginTop: 4 }}>
              {gs.reveal.qty} × {gs.reveal.face} · trovati {gs.reveal.actual} · perde {who(room, gs.reveal.loser)}
            </Micro>
            {["A", "B"].map((s) => (
              <div key={s} style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 8 }}>
                {gs.reveal.dice[s].map((d, i) => (
                  <Die key={i} v={d} size={30} hi={d === gs.reveal.face || d === 1} />
                ))}
              </div>
            ))}
          </div>
        ) : gs.bid ? (
          <div style={{ textAlign: "center" }}>
            <Micro>{who(room, gs.bid.seat)} dichiara</Micro>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
              <span className="pop" key={`${gs.bid.qty}-${gs.bid.face}`} style={{ fontFamily: BRAND, fontSize: 42, fontWeight: 700 }}>
                {gs.bid.qty}
              </span>
              <span style={{ fontSize: 24, color: T.ink60 }}>×</span>
              <Die v={gs.bid.face} size={42} />
            </div>
            <Micro style={{ marginTop: 8 }}>{total} dadi in gioco · gli 1 sono jolly</Micro>
          </div>
        ) : (
          <Micro>{gs.phase === "roll" ? "lanciate i dadi" : `${who(room, gs.turn)} apre le puntate`}</Micro>
        )}
      </div>

      {/* your dice */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>
          {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
        </div>
        <Micro>{gs.counts[seat]} dadi</Micro>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", minHeight: 52 }}>
        {rolled || gs.phase !== "roll"
          ? gs.dice[seat].map((d, i) => <Die key={i} v={d} size={46} roll={rolled && gs.phase === "roll"} />)
          : Array.from({ length: gs.counts[seat] }).map((_, i) => <Die key={i} hidden size={46} />)}
      </div>

      {/* actions */}
      <div style={{ marginTop: 18 }}>
        {gs.phase === "roll" &&
          (mine && !rolled ? (
            <Button full onClick={tapRoll}>
              Lancia i dadi — scuoti o tocca
            </Button>
          ) : (
            <Micro style={{ textAlign: "center" }}>{rolled ? `aspetta ${who(room, opp)}` : `lancia ${who(room, gs.turn)}`}</Micro>
          ))}

        {gs.phase === "bid" &&
          (mine ? (
            <div>
              <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 12 }}>
                {[2, 3, 4, 5, 6].map((f) => (
                  <Die key={f} v={f} size={38} on={bidFace === f} onClick={() => setBidFace(f)} />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 12 }}>
                <button onClick={() => setBidQty((q) => Math.max(1, q - 1))} style={stepBtn}>
                  −
                </button>
                <div style={{ fontFamily: BRAND, fontSize: 26, fontWeight: 700, minWidth: 40, textAlign: "center" }}>{bidQty}</div>
                <button onClick={() => setBidQty((q) => Math.min(total, q + 1))} style={stepBtn}>
                  +
                </button>
                <span style={{ color: T.ink60 }}>×</span>
                <Die v={bidFace} size={34} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button full disabled={!legal} onClick={() => commit(perudoBid(gs, seat, bidQty, bidFace))}>
                  Rilancia
                </Button>
                {gs.bid && (
                  <Button kind="line" onClick={() => commit(perudoDoubt(gs, seat))}>
                    Dubito!
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Micro style={{ textAlign: "center" }}>tocca a {who(room, gs.turn)}</Micro>
          ))}

        {gs.phase === "reveal" &&
          !gs.done &&
          (seat === gs.reveal.loser ? (
            <Button full onClick={() => commit(perudoNext(gs, seat))}>
              Nuovo giro
            </Button>
          ) : (
            <Micro style={{ textAlign: "center" }}>{who(room, gs.reveal.loser)} rilancia i dadi</Micro>
          ))}
      </div>
    </div>
  );
}
const stepBtn = {
  width: 42,
  height: 42,
  borderRadius: 999,
  border: `1.5px solid ${T.ink}`,
  background: "transparent",
  color: T.ink,
  fontSize: 22,
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

/* ── yahtzee ── */
function Yahtzee({ room, gs, seat, mine, commit }) {
  const opp = other(seat);
  const [motionOn, setMotionOn] = useState(false);
  const myScore = gs.scores[seat];
  const oppScore = gs.scores[opp];
  const myTotal = yahtTotal(myScore);
  const oppTotal = yahtTotal(oppScore);
  const canRoll = mine && gs.rollsLeft > 0 && !gs.done;
  const canScore = mine && gs.rolled && !gs.done;
  const doRoll = () => {
    if (mine && gs.rollsLeft > 0 && !gs.done) commit(yahtRoll(gs, seat));
  };
  useShake(doRoll, motionOn && canRoll);
  const tapRoll = async () => {
    if (!motionOn) setMotionOn(await requestMotion());
    doRoll();
  };

  return (
    <div>
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, opp)}</div>
        <Micro>
          {oppTotal.total} punti · {Object.keys(oppScore).length}/13
        </Micro>
      </div>

      {/* dice + roll */}
      <div style={{ margin: "16px 0 6px", textAlign: "center" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minHeight: 58, alignItems: "flex-end" }}>
          {gs.dice.map((d, i) => (
            <div key={i} style={{ transform: gs.keep[i] ? "translateY(-7px)" : "none", transition: "transform 150ms ease" }}>
              <Die
                v={d}
                size={48}
                hi={gs.keep[i]}
                roll={gs.rolled && !!d}
                onClick={mine && gs.rolled ? () => commit(yahtToggle(gs, seat, i)) : undefined}
              />
            </div>
          ))}
        </div>
        <Micro style={{ marginTop: 8, minHeight: 14 }}>{gs.rolled && canRoll ? "tocca i dadi da tenere" : ""}</Micro>
        <div style={{ marginTop: 10 }}>
          {mine && !gs.done ? (
            gs.rollsLeft > 0 ? (
              <Button full onClick={tapRoll}>
                {gs.rolled ? `Ritira · ${gs.rollsLeft} rimasti` : "Lancia i dadi — scuoti o tocca"}
              </Button>
            ) : (
              <Micro>segna un punteggio qui sotto</Micro>
            )
          ) : (
            <Micro>tocca a {who(room, opp)}</Micro>
          )}
        </div>
      </div>

      {/* your scorecard */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
        {YCATS.map((cat) => {
          const filled = cat.k in myScore;
          const preview = !filled && canScore ? yahtValue(cat.k, gs.dice) : null;
          const tappable = !filled && canScore;
          return (
            <button
              key={cat.k}
              disabled={!tappable}
              onClick={() => tappable && commit(yahtScore(gs, seat, cat.k))}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${tappable ? T.ink : T.line}`,
                background: filled ? "transparent" : tappable ? "rgba(18,18,18,0.03)" : "transparent",
                borderRadius: 8,
                padding: "9px 11px",
                cursor: tappable ? "pointer" : "default",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ fontSize: 13, color: filled ? T.ink60 : T.ink }}>{cat.label}</span>
              <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 15, color: filled ? T.ink : preview != null ? T.ink30 : T.line }}>
                {filled ? myScore[cat.k] : preview != null ? preview : "–"}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>
        <span style={{ color: T.ink60 }}>
          Bonus {myTotal.upper}/63{myTotal.bonus ? " +35" : ""}
        </span>
        <span>Totale {myTotal.total}</span>
      </div>
    </div>
  );
}

/* ── the finale ── */
const SUIT_COLS = ["#A8842A", "#A5342F", "#2C557E", "#3A6B4A"];
function Confetti() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: 16 }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            position: "absolute",
            left: `${(i * 6.1 + 4) % 96}%`,
            top: -14,
            width: i % 3 ? 7 : 9,
            height: i % 2 ? 9 : 7,
            background: SUIT_COLS[i % 4],
            borderRadius: i % 2 ? 2 : 0,
            animationDelay: `${(i % 6) * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ── shuffle & cut ── */
function Prepare({ room, seat, shuffleTap, shuffleDone, cutAndDeal }) {
  const prep = room.prep;
  const amDealer = seat === prep.dealer;
  const step = prep.step;
  const dealerName = who(room, prep.dealer);
  const cutterName = who(room, other(prep.dealer));

  // Entropy for the shuffle: a seed mixed from tap timing, rhythm and a running
  // animation-frame counter — the human's hands drive the randomness.
  const seedRef = useRef((0x9e3779b9 ^ ((prep.deck.length * 2654435761) >>> 0)) >>> 0);
  const lastTap = useRef(0);
  const frame = useRef(0);
  useEffect(() => {
    if (step !== "shuffle" || !amDealer) return;
    let raf;
    const loop = () => {
      frame.current = (frame.current + 1) >>> 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, amDealer]);
  const tap = () => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = now - lastTap.current;
    lastTap.current = now;
    let s = seedRef.current;
    s = (s ^ (Math.floor(now * 1000) >>> 0)) >>> 0;
    s = Math.imul(s, 2654435761) >>> 0;
    s = (s ^ (Math.floor(dt * 131) >>> 0)) >>> 0;
    s = (s ^ frame.current) >>> 0;
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    seedRef.current = s;
    shuffleTap(s);
    buzz("lay");
  };

  // Cut: drag across the spread to choose where to lift.
  const [cutAt, setCutAt] = useState(20);
  const barRef = useRef(null);
  const drag = useRef(false);
  const fromX = (clientX) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setCutAt(Math.max(2, Math.min(38, Math.round(frac * 40))));
  };
  const px = (e) => (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
  const onDown = (e) => {
    drag.current = true;
    fromX(px(e));
  };
  const onMove = (e) => {
    if (!drag.current) return;
    if (e.cancelable) e.preventDefault();
    fromX(px(e));
  };
  const onUp = () => {
    drag.current = false;
  };

  const wait = (title, sub) => (
    <div style={{ textAlign: "center", paddingTop: 70 }}>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18 }}>
        <Back size="sm" stack />
        <Back size="sm" />
      </div>
      <div style={{ fontFamily: BRAND, fontSize: 20, fontWeight: 600 }}>{title}</div>
      <Micro style={{ marginTop: 8 }}>{sub}</Micro>
    </div>
  );

  if (step === "shuffle" && !amDealer) return wait(`${dealerName} mescola`, `${prep.shuffles} mescolate`);
  if (step === "cut" && amDealer) return wait(`${cutterName} taglia il mazzo`, "un attimo");

  if (step === "shuffle")
    return (
      <div className="fade" style={{ textAlign: "center", paddingTop: 8 }}>
        <Micro>Mescola</Micro>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 300 }}>
          Tocca il mazzo per mescolare — più tocchi, più si mescola. Il ritmo delle tue dita decide le carte.
        </p>
        <button
          onClick={tap}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            margin: "26px 0 8px",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span key={prep.shuffles} className="pop" style={{ display: "inline-block" }}>
            <Deck3D n={40} faceUp={false} size="lg" />
          </span>
        </button>
        <div style={{ fontFamily: BRAND, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{prep.shuffles}</div>
        <Micro style={{ marginTop: 2 }}>mescolate</Micro>
        <div style={{ marginTop: 22 }}>
          <Button full disabled={prep.shuffles < 1} onClick={shuffleDone}>
            {prep.shuffles < 1 ? "Tocca per mescolare" : `Passa il taglio a ${cutterName}`}
          </Button>
        </div>
      </div>
    );

  // cut, shown to the non-dealer
  return (
    <div className="fade" style={{ textAlign: "center", paddingTop: 8 }}>
      <Micro>Taglia</Micro>
      <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 300 }}>
        Trascina lungo il mazzo per scegliere dove tagliare, poi conferma.
      </p>
      <div
        ref={barRef}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        style={{
          position: "relative",
          height: 108,
          margin: "24px 0 10px",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: "ew-resize",
        }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: 22, bottom: 22, display: "flex", gap: 1 }}>
          {Array.from({ length: 40 }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                borderRadius: 2,
                background: i < cutAt ? T.ink : "#4a4a48",
                boxShadow: i === cutAt - 1 ? `2px 0 0 ${T.bg}` : "none",
              }}
            />
          ))}
        </div>
        <div style={{ position: "absolute", top: 6, bottom: 6, left: `calc(${(cutAt / 40) * 100}% - 1px)`, width: 2, background: "#B8862B" }} />
        <div style={{ position: "absolute", top: -4, left: `calc(${(cutAt / 40) * 100}% - 8px)`, color: "#B8862B", fontSize: 16 }}>▼</div>
      </div>
      <Micro>
        {cutAt} sopra · {40 - cutAt} sotto
      </Micro>
      <div style={{ marginTop: 22 }}>
        <Button full onClick={() => cutAndDeal(cutAt)}>
          Taglia e distribuisci
        </Button>
      </div>
    </div>
  );
}
function Finale({ outcome }) {
  const win = outcome === "win";
  const draw = outcome === "draw";
  const word = win ? "Vittoria" : draw ? "Pareggio" : "Sconfitta";
  const color = win ? "#B8862B" : draw ? T.ink60 : T.ink30;
  return (
    <div style={{ position: "relative", textAlign: "center", padding: "6px 0 14px", overflow: "hidden" }}>
      {win && <Confetti />}
      <div
        className="pop"
        style={{
          position: "relative",
          fontFamily: BRAND,
          fontWeight: 700,
          fontSize: "clamp(48px, 17vw, 80px)",
          lineHeight: 0.95,
          letterSpacing: "-0.01em",
          color,
        }}
      >
        {word}
      </div>
    </div>
  );
}

/* ── summaries — the detail under the finale, no repeated headline ── */
function Summary({ room, gs }) {
  if (room.game === "scopa" && gs.summary)
    return (
      <div>
        {!gs.matchDone && (
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 10, fontFamily: BRAND }}>
            Mano contata
          </div>
        )}
        {gs.summary.lines.map((l, i) => (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", color: T.ink60 }}
          >
            <span>{l.why}</span>
            <span style={{ color: T.ink }}>
              {who(room, l.seat)} +{l.n}
            </span>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${T.line}`,
            marginTop: 10,
            paddingTop: 8,
            fontSize: 16,
            fontWeight: 600,
            fontFamily: BRAND,
          }}
        >
          <span>
            {who(room, "A")} {gs.scores.A}
          </span>
          <span>
            {who(room, "B")} {gs.scores.B}
          </span>
        </div>
      </div>
    );
  if ((room.game === "ruba" || room.game === "briscola" || room.game === "yahtzee") && gs.summary)
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: BRAND }}>
          {gs.summary.a} <span style={{ color: T.ink30 }}>—</span> {gs.summary.b}
        </div>
        <Micro style={{ marginTop: 4 }}>
          {who(room, "A")} · {who(room, "B")}
          {room.game === "briscola" ? " · punti su 120" : room.game === "yahtzee" ? " · punti totali" : ""} · mani {gs.tally.A}–{gs.tally.B}
        </Micro>
      </div>
    );
  return (
    <Micro style={{ textAlign: "center" }}>
      mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
    </Micro>
  );
}
