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
// One dim behind every modal dialog, so they all sit on the same scrim.
const SCRIM = "rgba(18,18,18,0.85)";
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
      { k: "target", label: "Partita a", cycle: [11, 16, 21], hint: "Punti che chiudono la partita" },
      { k: "asso", label: "Asso piglia tutto", cycle: [false, true], hint: "L’asso raccoglie tutte le carte del tavolo" },
      { k: "acepile", label: "Asso solo va in pila", cycle: [false, true], hint: "Un asso giocato su tavolo vuoto va in presa, non resta scoperto" },
      { k: "rebello", label: "Rebello", cycle: [false, true], hint: "Un punto extra a chi prende il re di denari" },
      { k: "napola", label: "Napola", cycle: [false, true], hint: "Bonus per l’asso, il due e il tre di denari nella stessa pila" },
    ],
    def: { target: 11, asso: false, acepile: false, rebello: false, napola: false },
  },
  scienza: {
    name: "Scopa scientifica",
    tag: "5 in mano, tavolo vuoto",
    line: "Come la scopa, ma cinque carte in mano e niente sul tavolo: più memoria, più strategia.",
    opts: [
      { k: "target", label: "Partita a", cycle: [11, 16, 21], hint: "Punti che chiudono la partita" },
      { k: "asso", label: "Asso piglia tutto", cycle: [false, true], hint: "L’asso raccoglie tutte le carte del tavolo" },
      { k: "rebello", label: "Rebello", cycle: [false, true], hint: "Un punto extra a chi prende il re di denari" },
      { k: "napola", label: "Napola", cycle: [false, true], hint: "Bonus per l’asso, il due e il tre di denari nella stessa pila" },
    ],
    def: { target: 11, hand: 5, notable: true, asso: false, acepile: false, rebello: false, napola: false },
  },
  ruba: {
    name: "Rubamazzo",
    tag: "ruba il mazzo",
    line: "Abbina il tavolo per raccogliere. Abbina la cima di un mazzo e lo rubi tutto.",
    opts: [
      { k: "sums", label: "Somme del nord", cycle: [false, true], hint: "Prendi anche abbinando la somma di più carte del tavolo" },
      { k: "pilesum", label: "Mazzo nelle somme", cycle: [false, true], hint: "La cima del mazzo avversario conta nelle somme" },
    ],
    def: { sums: false, pilesum: false },
  },
  camicia: {
    name: "Straccia camicia",
    tag: "niente scelte, solo nervi",
    line: "Gira la carta in cima. Asso, due e tre fanno pagare 1, 2 o 3 all’altro.",
    opts: [{ k: "intl", label: "Variante figure", cycle: [false, true], hint: "Anche le figure fanno pagare: Asso 4, Re 3, Cavallo 2, Fante 1" }],
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
  scala: {
    name: "Scala 40",
    tag: "aprire a quaranta",
    line: "Due mazzi francesi più due jolly. Cala tris e scale, apri con almeno 40 punti, poi attacca e svuota la mano.",
    big: true, // its own 106-card deck — no shuffle/cut ritual
    opts: [],
    def: {},
  },
  peppa: {
    name: "Peppa Tencia",
    tag: "chi resta con la Peppa",
    line: "Si tolgono tre cavalli: uno resta spaiato, la Peppa. Scarta le coppie, poi pesca a caso dall’altro. Chi resta con la Peppa perde.",
    instant: true, // its own 37-card deck — no shuffle/cut ritual
    opts: [],
    def: {},
  },
  condottieri: {
    name: "Condottieri",
    tag: "dadi in battaglia",
    line: "Ogni pedina è un dado: la faccia è la vita, e ferito colpisce meno. Schiera vicino al castello, poi muovi e tira. Vinci sterminando l’altro o prendendone il castello.",
    instant: true, // its own hex board — no card deck or shuffle ritual
    board: true, // a tactics board, not cards or dice-cups
    opts: [],
    def: {},
  },
};
const isCard = (game) => !GAMES[game].dice;
// Scala (its own big deck) and Peppa (a trimmed 37-card deck) skip the 40-card
// shuffle-and-cut ritual and are dealt straight away.
const usesRitual = (game) => isCard(game) && !GAMES[game].big && !GAMES[game].instant;
// Scopa and its scientific variant share the same engine, scoring and board.
const scopaLike = (game) => game === "scopa" || game === "scienza";
// A house rule is a plain on/off toggle when it only cycles false↔true; anything
// else (the point target, say) is a cycling value shown more prominently.
const isToggleOpt = (o) => o.cycle.length === 2 && o.cycle.every((v) => typeof v === "boolean");

/* ── scopa ─────────────────────────────────────────────────── */
// `pre` is a deck the players shuffled and cut by hand; when given it's dealt
// exactly as prepared (no reshuffle guard — their cut is respected).
function dealScopa(dealer, scores, o, pre) {
  const H = (o && o.hand) || 3; // hand size — 5 in the scientific variant
  const T = o && o.notable ? 0 : 4; // scientific starts with an empty table
  let deck, table;
  if (pre) {
    deck = pre.slice();
    table = deck.splice(0, T);
  } else
    do {
      deck = shuffle(makeDeck());
      table = deck.splice(0, T);
    } while (T && table.filter((c) => c.v === 10).length >= 3);
  return {
    deck,
    table,
    hands: { A: deck.splice(0, H), B: deck.splice(0, H) },
    piles: { A: [], B: [] },
    scope: { A: 0, B: 0 },
    scopeCards: { A: [], B: [] }, // the cards swept on each scopa, for the summary
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
      (g.scopeCards[seat] || (g.scopeCards[seat] = [])).push([...got, card].map((c) => ({ s: c.s, v: c.v })));
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
    const H = (o && o.hand) || 3;
    if (g.deck.length >= 2 * H) {
      g.hands[other(g.dealer)] = g.deck.splice(0, H);
      g.hands[g.dealer] = g.deck.splice(0, H);
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
  const oppP = g.piles[other(seat)];
  const pileTop = oppP.length ? oppP[oppP.length - 1] : null;
  if (pileTop && pileTop.v === card.v) out.push({ type: "steal" });
  // Mazzo nelle somme: the opponent's pile top counts as a value in a sum, so
  // pile-top + one or more table cards adding to your card steals the pile and
  // sweeps those table cards too.
  if (o.pilesum && pileTop && pileTop.v < card.v) {
    const seen = new Set();
    for (let m = 1; m < 1 << g.table.length; m++) {
      let sum = pileTop.v;
      const ids = [];
      const vs = [];
      for (let i = 0; i < g.table.length; i++)
        if (m & (1 << i)) {
          sum += g.table[i].v;
          ids.push(g.table[i].id);
          vs.push(g.table[i].v);
        }
      if (sum === card.v && ids.length >= 1) {
        const k = vs.sort((a, b) => a - b).join(".");
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ type: "stealsum", ids });
        }
      }
    }
  }
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
  } else if (opt && opt.type === "stealsum") {
    const pile = g.piles[other(seat)];
    const got = g.table.filter((c) => opt.ids.includes(c.id));
    g.table = g.table.filter((c) => !opt.ids.includes(c.id));
    kind = "scopa";
    ev = { t: "steal", v: card.v, s: card.s, n: pile.length + got.length };
    g.piles[seat] = [...g.piles[seat], ...pile, ...got, card];
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

/* ── peppa tencia (old maid) ──────────────────────────────────
   The Italian "vecchia". Three of one rank are pulled from the deck, leaving a
   single card with no possible partner — the Peppa. All 37 remaining cards are
   dealt out, each hand throws down every rank-pair on sight, then the players
   take turns drawing one blind card from the other's hand and pairing it off.
   The one left holding the Peppa when everything else is gone loses.

   Why it always ends: after the opening shed, no hand holds two of a rank, so a
   rank in play sits one card in each hand (its other pair already gone) — apart
   from the odd Peppa. So on your turn every card you can draw from the other
   hand is a rank you also hold and pairs at once, except the Peppa. Each real
   draw sheds a pair; the Peppa can only be passed back and forth a bounded
   number of times. No cycle guard needed. */
// The lone card is the Cavallo di Spade — value 9 renders as "Q" and suit S as
// "♠" on the French face, so it reads as the classic Old Maid Queen of Spades.
const PEPPA_ID = "S9";

function makePeppaDeck() {
  // Remove the other three Cavalli (v === 9), keeping only PEPPA_ID: rank 9 is
  // left with exactly one card, every other rank still has its two pairs.
  return makeDeck().filter((c) => c.v !== 9 || c.id === PEPPA_ID);
}

// Throw down every rank-pair in a hand. Four of a rank is two pairs; an odd
// card of a rank stays. Returns { hand, dropped } — dropped is the flat list of
// shed cards, for the pile count.
function peppaShed(hand) {
  const byV = {};
  for (const c of hand) (byV[c.v] = byV[c.v] || []).push(c);
  const keep = [];
  const dropped = [];
  for (const v in byV) {
    const group = byV[v];
    const pairs = Math.floor(group.length / 2) * 2;
    for (let i = 0; i < pairs; i++) dropped.push(group[i]);
    for (let i = pairs; i < group.length; i++) keep.push(group[i]);
  }
  return { hand: keep, dropped };
}

// Any empty hand ends it: that player got rid of everything and wins; the other
// is stuck with the Peppa. (The total is always odd, so one hand empties.)
function settlePeppa(g) {
  if (g.done) return;
  const eA = g.hands.A.length === 0;
  const eB = g.hands.B.length === 0;
  if (eA || eB) {
    g.done = true;
    g.matchDone = true;
    g.win = eA ? "A" : "B";
    g.tally[g.win] += 1;
  }
}

function dealPeppa(dealer, tally) {
  const d = shuffle(makePeppaDeck());
  const half = Math.ceil(d.length / 2);
  const a = peppaShed(d.slice(0, half));
  const b = peppaShed(d.slice(half));
  const g = {
    hands: { A: a.hand, B: b.hand },
    shed: { A: a.dropped.length, B: b.dropped.length }, // how many cards each has thrown down
    turn: other(dealer), // whose turn it is to draw this round
    // Each round has two beats: the player about to be drawn from (the holder,
    // = other(turn)) shuffles their hand as much as they like, then signals
    // ready; only then may the drawer pick a face-down card.
    phase: "arrange",
    dealer,
    last: null, // { seat, from, card, paired } — the most recent draw, for the reveal
    offer: null, // a card the holder has raised up as an "take this one" invitation
    tally: tally || { A: 0, B: 0 },
    done: false,
    matchDone: false,
    win: null,
  };
  settlePeppa(g);
  return g;
}

// The holder (other(turn)) reshuffles their own hand so the drawer can't track
// where the Peppa sits. Repeatable, silent, and only during the arrange beat.
function peppaShuffle(gs, seat) {
  if (gs.done || gs.phase !== "arrange" || seat !== other(gs.turn)) return null;
  const g = clone(gs);
  g.hands[seat] = shuffle(g.hands[seat]);
  g.offer = null;
  return { g, quiet: true, ev: { t: "pshuffle" } };
}

// The holder drags a card to a new spot in their hand. Broadcast so the drawer
// watches the (face-down) cards slide — part of the bluff.
function peppaReorder(gs, seat, cardId, toIndex) {
  if (gs.done || gs.phase !== "arrange" || seat !== other(gs.turn)) return null;
  const g = clone(gs);
  const hand = g.hands[seat];
  const from = hand.findIndex((c) => c.id === cardId);
  if (from < 0) return null;
  const ti = Math.max(0, Math.min(hand.length - 1, toIndex));
  if (ti === from) return null;
  const [card] = hand.splice(from, 1);
  hand.splice(ti, 0, card);
  return { g, quiet: true, ev: { t: "parrange" } };
}

// The holder raises a card up as an invitation to take it (or lowers it again).
function peppaOffer(gs, seat, cardId) {
  if (gs.done || gs.phase !== "arrange" || seat !== other(gs.turn)) return null;
  const g = clone(gs);
  g.offer = cardId && g.hands[seat].some((c) => c.id === cardId) ? (g.offer === cardId ? null : cardId) : null;
  return { g, quiet: true, ev: { t: "poffer" } };
}

// The holder presents the hand — the drawer may now pick.
function peppaReady(gs, seat) {
  if (gs.done || gs.phase !== "arrange" || seat !== other(gs.turn)) return null;
  const g = clone(gs);
  g.phase = "draw";
  return { g, quiet: true, ev: { t: "pready" } };
}

// `seat` draws the card at `idx` (a face-down slot) from the other hand. If it
// matches a rank already in hand, both go down as a pair; the turn then passes
// to the player just drawn from, who draws back.
function peppaDraw(gs, seat, idx) {
  const g = clone(gs);
  if (g.turn !== seat || g.done || g.phase !== "draw") return null;
  const from = other(seat);
  const src = g.hands[from];
  if (idx < 0 || idx >= src.length) return null;
  const card = src.splice(idx, 1)[0];
  const j = g.hands[seat].findIndex((c) => c.v === card.v);
  let paired = false;
  if (j >= 0) {
    g.hands[seat].splice(j, 1);
    g.shed[seat] += 2;
    paired = true;
  } else {
    g.hands[seat].push(card);
  }
  g.last = { seat, from, card, paired };
  g.offer = null;
  // The drawer becomes the next holder: they arrange, then the other draws back.
  g.turn = from;
  g.phase = "arrange";
  settlePeppa(g);
  return { g, kind: paired ? "scopa" : "lay", ev: { t: paired ? "ppair" : "pdraw", v: card.v, s: card.s }, card };
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

/* ── scala 40 ──────────────────────────────────────────────────
   Two French decks + two jokers (106 cards), 13 each. Draw from stock or the
   discard, lay sets (same rank, distinct suits) and runs (consecutive same suit,
   ace low or high, no K-A-2 wrap), then discard. Your first lay-down must total
   ≥40 points. After opening you may lay more and attach cards to any meld. Empty
   your hand to win. At most one joker per meld. */
const s40SlotVal = (r) => (r === 14 ? 11 : r === 1 ? 1 : r >= 11 ? 10 : r); // r 1..14, 1=ace low 14=ace high
const s40SetVal = (v) => (v === 1 ? 11 : v >= 11 ? 10 : v);
const s40Score = (c) => (c.joker ? 25 : c.v === 1 ? 11 : c.v >= 11 ? 10 : c.v);
// A joker with `rep:{s,v}` is pinned: it counts as that exact card. Only a
// joker with no rep is "free" and auto-placed (the simulator never pins).
function analyzeMeld(cards) {
  const free = cards.filter((c) => c.joker && !c.rep).length;
  const totalJokers = cards.filter((c) => c.joker).length;
  const nats = cards.map((c) => (c.joker && c.rep ? { s: c.rep.s, v: c.rep.v } : c)).filter((c) => !c.joker);
  if (cards.length < 3 || totalJokers > 1 || nats.length === 0) return { ok: false };
  if (nats.every((c) => c.v === nats[0].v)) {
    const suits = new Set(nats.map((c) => c.s));
    if (suits.size === nats.length && cards.length <= 4) return { ok: true, kind: "set", value: cards.length * s40SetVal(nats[0].v) };
  }
  if (nats.every((c) => c.s === nats[0].s)) {
    for (const aceHigh of [false, true]) {
      const pos = nats.map((c) => (c.v === 1 ? (aceHigh ? 14 : 1) : c.v)).sort((a, b) => a - b);
      if (new Set(pos).size !== pos.length) continue;
      const len = cards.length;
      for (let lo = pos[pos.length - 1] - len + 1; lo <= pos[0]; lo++) {
        const hi = lo + len - 1;
        if (lo < 1 || hi > 14 || pos[0] < lo || pos[pos.length - 1] > hi) continue;
        const natSet = new Set(pos);
        let gaps = 0;
        for (let r = lo; r <= hi; r++) if (!natSet.has(r)) gaps++;
        if (gaps !== free) continue;
        let value = 0;
        for (let r = lo; r <= hi; r++) value += s40SlotVal(r);
        return { ok: true, kind: "run", value };
      }
    }
  }
  return { ok: false };
}
// Distinct slots a single free joker could occupy in a valid run of `cards`,
// each { rank, suit }. Length ≥ 2 means the placement is ambiguous → ask.
function s40JokerRuns(cards) {
  if (cards.filter((c) => c.joker && !c.rep).length !== 1) return [];
  const nats = cards.map((c) => (c.joker && c.rep ? { s: c.rep.s, v: c.rep.v } : c)).filter((c) => !c.joker);
  if (nats.length === 0 || !nats.every((c) => c.s === nats[0].s)) return [];
  const suit = nats[0].s;
  const out = [];
  const seen = new Set();
  for (const aceHigh of [false, true]) {
    const pos = nats.map((c) => (c.v === 1 ? (aceHigh ? 14 : 1) : c.v)).sort((a, b) => a - b);
    if (new Set(pos).size !== pos.length) continue;
    const len = cards.length;
    for (let lo = pos[pos.length - 1] - len + 1; lo <= pos[0]; lo++) {
      const hi = lo + len - 1;
      if (lo < 1 || hi > 14 || pos[0] < lo || pos[pos.length - 1] > hi) continue;
      const natSet = new Set(pos);
      const gaps = [];
      for (let r = lo; r <= hi; r++) if (!natSet.has(r)) gaps.push(r);
      if (gaps.length !== 1 || seen.has(gaps[0])) continue;
      seen.add(gaps[0]);
      out.push({ rank: gaps[0], suit });
    }
  }
  return out;
}
function makeS40Deck() {
  const d = [];
  for (let copy = 0; copy < 2; copy++)
    for (const s of ["H", "D", "C", "S"]) for (let v = 1; v <= 13; v++) d.push({ id: `${s}${v}_${copy}`, s, v });
  d.push({ id: "JK0", joker: true }, { id: "JK1", joker: true });
  return d;
}
const s40Points = (h) => h.reduce((s, c) => s + s40Score(c), 0);
const s40ById = (hand, ids) => ids.map((id) => hand.find((c) => c.id === id));
function s40CheckOut(g, seat) {
  if (g.hands[seat].length === 0) {
    g.done = true;
    g.matchDone = true;
    g.win = seat;
    g.tally[seat] += 1;
    g.penalty = s40Points(g.hands[other(seat)]);
  }
}
function dealScala(dealer, tally, pre) {
  const deck = pre ? pre.slice() : shuffle(makeS40Deck());
  const hands = { A: deck.splice(0, 13), B: deck.splice(0, 13) };
  const discard = [deck.pop()];
  return {
    deck,
    discard,
    hands,
    melds: [],
    opened: { A: false, B: false },
    turn: other(dealer),
    dealer,
    phase: "draw",
    tally: tally || { A: 0, B: 0 },
    done: false,
    matchDone: false,
    win: null,
    penalty: null,
  };
}
// The top of the scarti may be taken only if it can be used at once: laid off
// onto a table meld (once opened), or combined with two hand cards into a valid
// tris/scala — the card you'd then open or cala with. Drawing from the mazzo is
// always free.
function s40CanUseDiscard(gs, seat) {
  const top = gs.discard[gs.discard.length - 1];
  if (!top) return false;
  const hand = gs.hands[seat];
  if (gs.opened[seat]) for (const m of gs.melds) if (analyzeMeld([...m.cards, top]).ok) return true;
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) if (analyzeMeld([top, hand[i], hand[j]]).ok) return true;
  return false;
}
function s40Draw(gs, seat, source) {
  const g = clone(gs);
  if (g.phase !== "draw" || g.turn !== seat || g.done) return null;
  let card;
  if (source === "discard") {
    if (!g.discard.length || !s40CanUseDiscard(g, seat)) return null;
    card = g.discard.pop();
  } else {
    if (!g.deck.length) {
      const top = g.discard.pop();
      g.deck = shuffle(g.discard);
      g.discard = top ? [top] : [];
    }
    if (!g.deck.length) return null;
    card = g.deck.pop();
  }
  g.hands[seat].push(card);
  g.phase = "meld";
  return { g, kind: "take", ev: { t: "draw", source } };
}
function s40Open(gs, seat, melds) {
  const g = clone(gs);
  if (g.phase !== "meld" || g.turn !== seat || g.opened[seat] || g.done) return null;
  const used = new Set();
  let value = 0;
  const laid = [];
  for (const m of melds) {
    if (m.ids.some((id) => used.has(id))) return null;
    const cards = s40ById(g.hands[seat], m.ids);
    if (cards.some((c) => !c)) return null;
    s40ApplyReps(cards, m.reps);
    const a = analyzeMeld(cards);
    if (!a.ok) return null;
    value += a.value;
    m.ids.forEach((id) => used.add(id));
    laid.push({ cards, kind: a.kind });
  }
  if (value < 40) return null;
  g.hands[seat] = g.hands[seat].filter((c) => !used.has(c.id));
  for (const l of laid) g.melds.push({ id: "m" + g.melds.length + seat, cards: l.cards, kind: l.kind, owner: seat });
  g.opened[seat] = true;
  s40CheckOut(g, seat);
  return { g, kind: "scopa", ev: { t: "open", value } };
}
// Pin the chosen value onto a joker before analysis, so the melded card
// carries what it stands for. reps: { [jokerId]: {s,v} }.
function s40ApplyReps(cards, reps) {
  if (!reps) return;
  for (const c of cards) if (c.joker && reps[c.id]) c.rep = reps[c.id];
}
function s40Meld(gs, seat, ids, reps) {
  const g = clone(gs);
  if (g.phase !== "meld" || g.turn !== seat || !g.opened[seat] || g.done) return null;
  const cards = s40ById(g.hands[seat], ids);
  if (cards.some((c) => !c)) return null;
  s40ApplyReps(cards, reps);
  const a = analyzeMeld(cards);
  if (!a.ok) return null;
  const set = new Set(ids);
  g.hands[seat] = g.hands[seat].filter((c) => !set.has(c.id));
  g.melds.push({ id: "m" + g.melds.length + seat, cards, kind: a.kind, owner: seat });
  s40CheckOut(g, seat);
  return { g, kind: "lay", ev: { t: "meld" } };
}
function s40LayOff(gs, seat, cardId, meldId, rep) {
  const g = clone(gs);
  if (g.phase !== "meld" || g.turn !== seat || !g.opened[seat] || g.done) return null;
  const card = g.hands[seat].find((c) => c.id === cardId);
  const meld = g.melds.find((m) => m.id === meldId);
  if (!card || !meld) return null;
  if (rep && card.joker) card.rep = rep;
  const a = analyzeMeld([...meld.cards, card]);
  if (!a.ok) return null;
  meld.cards = [...meld.cards, card];
  meld.kind = a.kind;
  g.hands[seat] = g.hands[seat].filter((c) => c.id !== cardId);
  s40CheckOut(g, seat);
  return { g, kind: "take", ev: { t: "layoff" } };
}
function s40Discard(gs, seat, cardId) {
  const g = clone(gs);
  if (g.phase !== "meld" || g.turn !== seat || g.done) return null;
  const card = g.hands[seat].find((c) => c.id === cardId);
  if (!card) return null;
  g.hands[seat] = g.hands[seat].filter((c) => c.id !== cardId);
  g.discard.push(card);
  if (g.hands[seat].length === 0) s40CheckOut(g, seat);
  else {
    g.turn = other(seat);
    g.phase = "draw";
  }
  return { g, kind: "lay", ev: { t: "discard" } };
}

/* ── condottieri (tactics) ─────────────────────────────────────
   A dice skirmish on a hex board. Each unit IS a die: its face shows its
   current HP, and because a wounded die hits weaker, an attack rolls 1..HP —
   the die literally shrinks as it takes damage. Rolling the top face (≥2)
   explodes for a crit. Two classes: Fante (d8, melee, adjacent) and Arciere
   (d6, ranged 2–3, needs line of sight). Both step up to 2. Deploy near your
   castle, then take turns activating one unit (move, then attack) — a unit may
   be activated twice in a round, so you can push the same one across the map.
   Heal on your fountain (+3) or castle (full). A castle bombards any enemy that
   ends its turn beside it for 2. Win by wiping the enemy — or by holding their
   castle: step in, survive their retaliation, and the keep is yours. A round
   cap ends stalls on total HP. Obstacles block movement and line of sight;
   there is no elevation. */
const TACT = {
  R: 8, // map radius — a hexagon this many rings across, then eroded to an irregular coast
  ERODE: 0.34, // chance a border hex is chipped away each pass (2 passes) → random shape
  BLOCK: 0.2, // share of the open interior turned to rubble — cover + broken lines of sight
  DEPLOY_R: 2, // deploy within this many hexes of your castle
  ROUND_CAP: 40,
  ACTS: 2, // activations a single unit may spend per round — you can move the same one twice
  CASTLE_DMG: 2, // a castle bombards any enemy that ends its turn next to it
  units: {
    // A big board with lots of rubble is the balance: both classes step only 2,
    // so crossing it takes several turns — but a unit may be activated twice in a
    // round, and an Arciere kites and picks the enemy off on the way in.
    fante: { name: "Fante", max: 8, move: 2, min: 1, rng: 1 }, // d8 melee, closes slowly
    arciere: { name: "Arciere", max: 6, move: 2, min: 2, rng: 3 }, // d6, shoots 2–3 away, never adjacent
  },
};
const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const hkey = (q, r) => `${q},${r}`;
const unhkey = (k) => {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
};
const hdist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

// Flood-fill: are all open hexes one connected region? (No unit ever walled off.)
function tacticsConnected(openSet) {
  const keys = [...openSet];
  if (!keys.length) return false;
  const seen = new Set([keys[0]]);
  const stack = [keys[0]];
  while (stack.length) {
    const { q, r } = unhkey(stack.pop());
    for (const [dq, dr] of HEX_DIRS) {
      const nk = hkey(q + dq, r + dr);
      if (openSet.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        stack.push(nk);
      }
    }
  }
  return seen.size === openSet.size;
}
// The largest connected clump of a hex set — used to drop islands after erosion.
function tacticsLargest(set) {
  const seen = new Set();
  let best = new Set();
  for (const start of set) {
    if (seen.has(start)) continue;
    const comp = new Set([start]);
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const { q, r } = unhkey(stack.pop());
      for (const [dq, dr] of HEX_DIRS) {
        const nk = hkey(q + dq, r + dr);
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          comp.add(nk);
          stack.push(nk);
        }
      }
    }
    if (comp.size > best.size) best = comp;
  }
  return best;
}
// One attempt at an irregular island. Returns null if the shape can't seat both
// squads or can't stay connected once rubble is added, so the caller can retry.
function tacticsBoardTry(R, erode) {
  let set = new Set();
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) set.add(hkey(q, r));
  if (erode) {
    const onCoast = (k) => {
      const { q, r } = unhkey(k);
      return HEX_DIRS.some(([dq, dr]) => !set.has(hkey(q + dq, r + dr)));
    };
    for (let pass = 0; pass < 2; pass++) for (const k of [...set]) if (onCoast(k) && Math.random() < TACT.ERODE) set.delete(k);
    set = tacticsLargest(set);
  }
  const cells = [...set].map(unhkey);
  const rMin = Math.min(...cells.map((c) => c.r)),
    rMax = Math.max(...cells.map((c) => c.r));
  const midOf = (rr) => {
    const row = cells.filter((c) => c.r === rr).sort((a, b) => a.q - b.q);
    return row[Math.floor(row.length / 2)];
  };
  const cB = midOf(rMin),
    cA = midOf(rMax); // castles at the far vertical ends
  // enough room to deploy 4 next to each castle, or this shape is no good
  const deployRoom = (c) => cells.filter((x) => hdist(x, c) <= TACT.DEPLOY_R).length;
  if (deployRoom(cA) < 4 || deployRoom(cB) < 4) return null;
  const inward = (from, steps) => {
    let cur = from;
    for (let i = 0; i < steps; i++) {
      let best = cur,
        bd = hdist(cur, { q: 0, r: 0 });
      for (const [dq, dr] of HEX_DIRS) {
        const n = { q: cur.q + dq, r: cur.r + dr };
        if (set.has(hkey(n.q, n.r)) && hdist(n, { q: 0, r: 0 }) < bd) {
          best = n;
          bd = hdist(n, { q: 0, r: 0 });
        }
      }
      cur = best;
    }
    return cur;
  };
  const fA = inward(cA, 3),
    fB = inward(cB, 3);
  const castle = { A: hkey(cA.q, cA.r), B: hkey(cB.q, cB.r) };
  const fount = { A: hkey(fA.q, fA.r), B: hkey(fB.q, fB.r) };
  const reserved = new Set([castle.A, castle.B, fount.A, fount.B]);
  const nearCastle = (c) => hdist(c, cA) <= TACT.DEPLOY_R || hdist(c, cB) <= TACT.DEPLOY_R;
  for (let attempt = 0; attempt < 60; attempt++) {
    const blocked = {};
    for (const c of cells) {
      const k = hkey(c.q, c.r);
      if (reserved.has(k) || nearCastle(c)) continue; // deploy zones + specials stay clear
      if (Math.random() < TACT.BLOCK) blocked[k] = true;
    }
    const openSet = new Set(cells.map((c) => hkey(c.q, c.r)).filter((k) => !blocked[k]));
    if (tacticsConnected(openSet) && openSet.has(castle.A) && openSet.has(castle.B)) return { cells, blocked, castle, fount };
  }
  return null;
}
// A big, irregular island: chew a hexagon's edges into a jagged coast, keep the
// largest piece, scatter rubble. Retries until it's playable; a plain hexagon
// (no erosion) is the always-works fallback.
function tacticsBoard() {
  for (let tries = 0; tries < 40; tries++) {
    const b = tacticsBoardTry(TACT.R, true);
    if (b) return b;
  }
  return tacticsBoardTry(TACT.R, false) || tacticsBoardTry(TACT.R - 1, false);
}

function dealTactics(dealer, opts, tally) {
  return {
    board: tacticsBoard(),
    phase: "roster", // roster → deploy → battle
    roster: { A: null, B: null }, // chosen number of Fanti (1..3); Arcieri = 4 − that
    units: {}, // id → { id, owner, type, hp, max, q, r }
    order: [], // stable unit ids
    toPlace: { A: [], B: [] }, // unit types still to deploy
    turn: dealer || "A",
    spent: {}, // unit id → activations used this round (capped at TACT.ACTS)
    siege: null, // { seat, unitId, armed } — a unit sitting in the enemy castle
    round: 1,
    dealer: dealer || "A",
    tally: tally || { A: 0, B: 0 },
    last: null, // last resolved attack, for the roll reveal
    how: null, // "wipe" | "castle" | "timeout"
    done: false,
    matchDone: false,
    win: null,
  };
}

const tacticsOccupied = (g, k) => g.order.some((id) => hkey(g.units[id].q, g.units[id].r) === k);
const tacticsOpen = (g, k) => !g.board.blocked[k] && g.board.cells.some((c) => hkey(c.q, c.r) === k);
function tacticsDeployable(g, seat, k) {
  if (!tacticsOpen(g, k) || tacticsOccupied(g, k)) return false;
  return hdist(unhkey(k), unhkey(g.board.castle[seat])) <= TACT.DEPLOY_R;
}

function tacticsRoster(gs, seat, fante) {
  if (gs.done || gs.phase !== "roster" || gs.turn !== seat || gs.roster[seat] != null) return null;
  if (![1, 2, 3].includes(fante)) return null; // 4-unit roster, at least one of each kind
  const g = clone(gs);
  g.roster[seat] = fante;
  if (g.roster[other(seat)] == null) g.turn = other(seat);
  else {
    for (const s of ["A", "B"]) {
      const f = g.roster[s];
      g.toPlace[s] = [...Array(f).fill("fante"), ...Array(4 - f).fill("arciere")];
    }
    g.phase = "deploy";
    g.turn = g.dealer;
  }
  return { g, quiet: true, ev: { t: "roster", fante } };
}

function tacticsDeploy(gs, seat, type, k) {
  if (gs.done || gs.phase !== "deploy" || gs.turn !== seat) return null;
  const g = clone(gs);
  const queue = g.toPlace[seat];
  const i = queue.indexOf(type);
  if (i < 0 || !tacticsDeployable(g, seat, k)) return null;
  const { q, r } = unhkey(k);
  const id = `${seat}${type[0]}${g.order.length}`;
  g.units[id] = { id, owner: seat, type, hp: TACT.units[type].max, max: TACT.units[type].max, q, r };
  g.order.push(id);
  queue.splice(i, 1);
  if (queue.length === 0) {
    if (g.toPlace[other(seat)].length) g.turn = other(seat);
    else {
      g.phase = "battle";
      g.turn = g.dealer;
      g.round = 1;
      g.spent = {};
    }
  }
  return { g, quiet: true, ev: { t: "deploy", type } };
}

// Hexes a unit can step to (BFS to its Move, around obstacles and other units).
function tacticsReach(g, unit) {
  const start = hkey(unit.q, unit.r);
  const move = TACT.units[unit.type].move;
  const occ = new Set(g.order.filter((id) => id !== unit.id).map((id) => hkey(g.units[id].q, g.units[id].r)));
  const dist = { [start]: 0 };
  const q = [start];
  while (q.length) {
    const k = q.shift();
    if (dist[k] >= move) continue;
    const { q: cq, r: cr } = unhkey(k);
    for (const [dq, dr] of HEX_DIRS) {
      const nk = hkey(cq + dq, cr + dr);
      if (dist[nk] !== undefined || !tacticsOpen(g, nk) || occ.has(nk)) continue;
      dist[nk] = dist[k] + 1;
      q.push(nk);
    }
  }
  delete dist[start];
  return dist;
}

function cubeRound(q, r, s) {
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr };
}
function tacticsLoS(g, a, b) {
  const N = hdist(a, b);
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const p = cubeRound(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t, -a.q - a.r + (-b.q - b.r - (-a.q - a.r)) * t);
    if (g.board.blocked[hkey(p.q, p.r)]) return false;
  }
  return true;
}
function tacticsTargets(g, unit) {
  const u = TACT.units[unit.type];
  return g.order.filter((id) => {
    const t = g.units[id];
    if (t.owner === unit.owner) return false;
    const d = hdist(unit, t);
    if (d < u.min || d > u.rng) return false;
    if (u.rng > 1 && !tacticsLoS(g, unit, t)) return false;
    return true;
  });
}
// Resting on your own fountain/castle to heal means no attack that turn.
const tacticsHeals = (g, seat, k) => k === g.board.castle[seat] || k === g.board.fount[seat];

// Roll 1..HP; rolling the top face (≥2) explodes and rolls again — a crit.
function tacticsRoll(hp) {
  const face = hp;
  let total = 0,
    crit = false;
  for (let i = 0; i < 6; i++) {
    const r = 1 + Math.floor(Math.random() * face);
    total += r;
    if (r === face && face >= 2) {
      crit = true;
      continue;
    }
    break;
  }
  return { total, crit };
}

function tacticsWin(g, winner, how) {
  g.done = true;
  g.matchDone = true;
  g.win = winner;
  g.how = how;
  if (winner) g.tally[winner] += 1;
}
// A unit sitting in the enemy castle only takes it if it survives one round of
// the opponent's retaliation: arming happens when control passes to the foe,
// and the capture lands when the turn comes back with the unit still in place.
function tacticsResolveSiege(g) {
  const s = g.siege;
  if (!s || g.done) return;
  const u = g.units[s.unitId];
  if (!u || hkey(u.q, u.r) !== g.board.castle[other(s.seat)]) {
    g.siege = null; // it died or left the keep — siege broken
    return;
  }
  if (g.turn === other(s.seat)) s.armed = true; // the defender gets their turn
  else if (g.turn === s.seat && s.armed) tacticsWin(g, s.seat, "castle");
}
function tacticsPassTurn(g) {
  const unspent = (s) => g.order.some((id) => g.units[id].owner === s && (g.spent[id] || 0) < TACT.ACTS);
  const foe = other(g.turn);
  if (unspent(foe)) {
    g.turn = foe;
    tacticsResolveSiege(g);
    return;
  }
  if (unspent(g.turn)) {
    tacticsResolveSiege(g); // opponent is out of units this round; keep going
    return;
  }
  g.round += 1;
  g.spent = {};
  if (g.round > TACT.ROUND_CAP) {
    const hp = (s) => g.order.filter((id) => g.units[id].owner === s).reduce((t, id) => t + g.units[id].hp, 0);
    const a = hp("A"),
      b = hp("B");
    tacticsWin(g, a === b ? null : a > b ? "A" : "B", "timeout");
    return;
  }
  g.turn = foe;
  tacticsResolveSiege(g);
}

// One activation, resolved atomically: optionally move to `toKey`, then either
// attack a target or wait. Healing on your own castle/fountain is automatic.
function tacticsActivate(gs, seat, unitId, toKey, action) {
  if (gs.done || gs.phase !== "battle" || gs.turn !== seat) return null;
  const g = clone(gs);
  const unit = g.units[unitId];
  if (!unit || unit.owner !== seat || (g.spent[unitId] || 0) >= TACT.ACTS) return null;
  if (toKey && toKey !== hkey(unit.q, unit.r)) {
    if (tacticsReach(g, unit)[toKey] === undefined) return null;
    const { q, r } = unhkey(toKey);
    unit.q = q;
    unit.r = r;
  }
  const uk = hkey(unit.q, unit.r); // final position after any move
  let ev = { t: "wait", unit: unit.type };
  let kind = "lay";
  let roll = null;
  if (action && action.kind === "attack") {
    if (tacticsHeals(g, seat, uk)) return null; // healing on your keep/fountain — can't also attack
    const target = g.units[action.targetId];
    if (!target || target.owner === seat) return null;
    const u = TACT.units[unit.type];
    const d = hdist(unit, target);
    if (d < u.min || d > u.rng || (u.rng > 1 && !tacticsLoS(g, unit, target))) return null;
    const res = tacticsRoll(unit.hp);
    target.hp -= res.total;
    const killed = target.hp <= 0;
    if (killed) {
      delete g.units[action.targetId];
      g.order = g.order.filter((id) => id !== action.targetId);
    }
    roll = { attacker: unitId, target: action.targetId, atkType: unit.type, tgtType: target.type, dmg: res.total, crit: res.crit, killed };
    ev = { t: "attack", unit: unit.type, target: target.type, dmg: res.total, crit: res.crit, killed };
    kind = res.crit ? "scopa" : "take"; // a crit gets the big slam + shake
  }
  // castle bombardment: a unit that ends its turn adjacent to the ENEMY castle
  // (but not standing in it — that's a siege, resolved below) is shelled for 2.
  const foeCastle = g.board.castle[other(seat)];
  if (uk !== foeCastle && hdist(unit, unhkey(foeCastle)) === 1) {
    unit.hp -= TACT.CASTLE_DMG;
    ev = { ...ev, bombed: TACT.CASTLE_DMG };
    if (unit.hp <= 0) {
      delete g.units[unitId];
      g.order = g.order.filter((id) => id !== unitId);
    }
  }
  const alive = !!g.units[unitId];
  if (alive) {
    if (uk === g.board.castle[seat]) unit.hp = unit.max; // rally to full at your keep
    else if (uk === g.board.fount[seat]) unit.hp = Math.min(unit.max, unit.hp + 3);
  }
  g.last = { ...(roll || {}), unitId, to: uk };
  // holding the enemy castle doesn't win on contact: plant the siege and let it
  // ride out the opponent's retaliation (the capture lands in tacticsPassTurn).
  if (alive && uk === foeCastle) {
    if (!g.siege || g.siege.unitId !== unitId) g.siege = { seat, unitId, armed: false };
  } else if (g.siege && g.siege.unitId === unitId) {
    g.siege = null; // this unit is the besieger no longer
  }
  if (!g.order.some((id) => g.units[id].owner === "A")) tacticsWin(g, "B", "wipe");
  else if (!g.order.some((id) => g.units[id].owner === "B")) tacticsWin(g, "A", "wipe");
  if (!g.done) {
    g.spent[unitId] = (g.spent[unitId] || 0) + 1;
    tacticsPassTurn(g);
  }
  return { g, kind, ev, roll };
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

/* A running head-to-head record between two named players, kept locally (same
   private storage as the prefs) so the same two people see their tally build up
   across sessions. Keyed by the pair of names, normalised so case/spacing match. */
const BOARD = "osteria:scoreboard";
const nrm = (n) => (n || "").trim().toLowerCase();
const pairKey = (a, b) => [nrm(a), nrm(b)].sort().join("␟");
async function saveBoard(b) {
  try {
    const v = JSON.stringify(b);
    if (hasStore()) await window.storage.set(BOARD, v, false);
    else localStorage.setItem(BOARD, v);
  } catch {}
}
async function loadBoard() {
  try {
    if (hasStore()) {
      const r = await window.storage.get(BOARD, false);
      return r ? JSON.parse(r.value) : {};
    }
    const v = localStorage.getItem(BOARD);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}
function recordWin(board, a, b, winner, game) {
  const nb = JSON.parse(JSON.stringify(board || {}));
  const pk = pairKey(a, b);
  const rec = (nb[pk] = nb[pk] || { disp: {}, byGame: {} });
  rec.disp[nrm(a)] = a;
  rec.disp[nrm(b)] = b;
  rec.byGame[game] = rec.byGame[game] || {};
  const w = nrm(winner);
  rec.byGame[game][w] = (rec.byGame[game][w] || 0) + 1;
  return nb;
}

/* Same-origin WebSocket relay — the Cloudflare Worker in ./worker. If it isn't
   there (a plain static host), the app falls back to PeerJS on its own. */
function relayUrl(code) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/room/${code.toUpperCase()}`;
}
function bumpUrl(coords) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const q = coords ? `?lat=${coords.lat.toFixed(5)}&lng=${coords.lng.toFixed(5)}` : "";
  return `${proto}//${location.host}/bump${q}`;
}
// In-app QR scanning needs both a camera and the BarcodeDetector API (Chrome /
// Android — including the S23; Safari lacks it and uses the native camera).
const hasScanner = () =>
  typeof window !== "undefined" && "BarcodeDetector" in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
// Pull a four-letter table code out of a scanned QR — a join URL (?t=CODE) or a
// bare code.
function codeFromScan(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw, typeof location !== "undefined" ? location.origin : "https://osteria");
    const t = (u.searchParams.get("t") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (t.length === 4) return t;
  } catch {}
  const m = String(raw).toUpperCase().replace(/[^A-Z]/g, "");
  return m.length === 4 ? m : null;
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
// ICE servers for the peer-to-peer fallback. STUN lets two phones find each
// other; the TURN relays carry the data when they can't reach each other
// directly — the usual case on a shared hotspot that isolates its clients or
// puts both behind one NAT. Only used on the PeerJS path (never in the artifact,
// which has no network). Both phones need internet, which the hotspot provides.
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

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
    case "pdraw":
      return `pesca una carta — tiene il ${r(ev.v)} di ${suitName(ev.s, french)}`;
    case "ppair":
      return `pesca il ${r(ev.v)} e scarta la coppia`;
    case "pshuffle":
      return "rimescola la mano";
    case "parrange":
      return "sistema le carte";
    case "poffer":
      return "offre una carta";
    case "pready":
      return "presenta la mano";
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

const SZ = { xs: [36, 52], sm: [46, 66], md: [58, 82], lg: [74, 104], xl: [96, 136] };

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

/* A genuinely three-dimensional deck: the cards are stacked along the Z axis
   inside a `perspective` scene and the whole block is tilted toward the viewer,
   so the pile has real depth and foreshortening (not a flat screen-offset fake).
   Count sets the height of the block. `lift` (0..1) raises it as you drag up. */
function DeckBox({ n, size = "md", live, lift = 0, faceUp, top, slamId }) {
  const [w, h] = SZ[size];
  if (!n) return <Ghost size={size} />;
  const layers = Math.min(n, 26);
  const gap = 1.8; // Z distance between card faces
  const depth = (layers - 1) * gap;
  const tilt = 26; // degrees the block leans toward the viewer
  const proj = Math.sin((tilt * Math.PI) / 180) * depth; // how tall the tilt reads
  const rad = 7;
  return (
    <div style={{ width: w, height: Math.round(h + proj + 8), perspective: 620, flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div
        className={live ? "deckbob" : ""}
        style={{
          position: "relative",
          width: w,
          height: h,
          marginBottom: proj / 2,
          transformStyle: "preserve-3d",
          transform: `rotateX(${tilt}deg) translateZ(${lift * 26}px)`,
          transformOrigin: "50% 100%",
          transition: "transform 220ms cubic-bezier(.2,.9,.25,1)",
        }}
      >
        {Array.from({ length: layers }).map((_, i) => {
          const isTop = i === layers - 1;
          const z = i * gap - depth / 2;
          const shade = faceUp ? "#F2EFE8" : `hsl(28 6% ${5 + (i / layers) * 6}%)`;
          if (isTop) {
            return (
              <div key="top" style={{ position: "absolute", inset: 0, transform: `translateZ(${z}px)` }}>
                {faceUp && top ? <Card card={top} size={size} rot={0} slam={slamId === top.id} /> : <Back size={size} />}
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                width: w,
                height: h,
                borderRadius: rad,
                transform: `translateZ(${z}px)`,
                background: shade,
                borderBottom: `1px solid ${faceUp ? "rgba(18,18,18,0.12)" : "rgba(255,255,255,0.05)"}`,
                boxShadow: i === layers - 2 ? "0 8px 16px rgba(18,18,18,0.28)" : "none",
              }}
            />
          );
        })}
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

// `soft` is a muted look for an action that isn't legal yet but is still
// tappable — the handler explains what's missing rather than dead-ending.
function Button({ children, onClick, disabled, soft, kind = "solid", full }) {
  const solid = kind === "solid";
  const muted = disabled || soft;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: full ? "100%" : "auto",
        background: muted ? "transparent" : solid ? T.ink : "transparent",
        color: muted ? T.ink30 : solid ? T.bg : T.ink,
        border: `1.5px solid ${muted ? T.line : T.ink}`,
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

// One consistent line-icon set, in place of emoji: thin strokes on currentColor,
// same hairline language as the deck. `n` names the glyph; `s` is the pixel box.
function Ico({ n, s = 18, c, sw = 1.7, style, cls }) {
  const P = { fill: "none", stroke: c || "currentColor", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  const dot = (x, y) => <circle cx={x} cy={y} r="1.15" fill={c || "currentColor"} stroke="none" />;
  const g = {
    sword: (
      <>
        <path {...P} d="M14.5 17.5 4 7V4h3l10.5 10.5" />
        <path {...P} d="m13 18 5-5M15.5 15.5l4 4M18 21l2-2" />
      </>
    ),
    bow: (
      <>
        <path {...P} d="M6 18A16 16 0 0 1 18 6" />
        <path {...P} d="M6 18 18 6" />
        <path {...P} d="M3.5 20.5 20 4M20 4h-4M20 4v4" />
      </>
    ),
    castle: (
      <>
        <path {...P} d="M5 21V10M19 21V10M4 21h16" />
        <path {...P} d="M4 10V7h3v2h2V7h2v2h2V7h2v2h2V7h3v3" />
        <path {...P} d="M10 21v-4a2 2 0 0 1 4 0v4" />
      </>
    ),
    drop: <path {...P} d="M12 3s6 6.4 6 10a6 6 0 0 1-12 0c0-3.6 6-10 6-10Z" />,
    shuffle: (
      <>
        <path {...P} d="M3 17h3.4c1.2 0 2.3-.6 3-1.6l5.2-7.2c.7-1 1.8-1.6 3-1.6H21" />
        <path {...P} d="m18 4 3 3-3 3" />
        <path {...P} d="M3 7h3.4c1.2 0 2.3.6 3 1.6" />
        <path {...P} d="M14.4 15.4c.7 1 1.8 1.6 3 1.6H21" />
        <path {...P} d="m18 14 3 3-3 3" />
      </>
    ),
    up: <path {...P} d="M12 19V5M6 11l6-6 6 6" />,
    dice: (
      <>
        <rect {...P} x="4" y="4" width="16" height="16" rx="3.5" />
        {dot(9, 9)}
        {dot(15, 9)}
        {dot(9, 15)}
        {dot(15, 15)}
      </>
    ),
    burst: <path {...P} d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3 3M15.8 15.8l3 3M18.8 5.2l-3 3M8.2 15.8l-3 3" />,
    wine: (
      <>
        <path {...P} d="M8 3h8M7 3c0 5 1.6 8 5 8s5-3 5-8" />
        <path {...P} d="M12 11v7M8.5 21h7" />
      </>
    ),
    exit: (
      <>
        <path {...P} d="M10 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path {...P} d="m16 17 5-5-5-5M21 12H9" />
      </>
    ),
    clip: (
      <>
        <rect {...P} x="8" y="3" width="8" height="4" rx="1" />
        <path {...P} d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
        <path {...P} d="M8.5 11h7M8.5 15h5" />
      </>
    ),
    share: (
      <>
        <path {...P} d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
        <path {...P} d="M16 6l-4-4-4 4M12 2v13" />
      </>
    ),
    download: (
      <>
        <path {...P} d="M12 3v12M8 11l4 4 4-4" />
        <path {...P} d="M5 21h14" />
      </>
    ),
    flask: (
      <>
        <path {...P} d="M9 3h6M10 3v6.5L5.4 17a2 2 0 0 0 1.7 3h9.8a2 2 0 0 0 1.7-3L14 9.5V3" />
        <path {...P} d="M7.5 15h9" />
      </>
    ),
    bump: (
      <>
        <path {...P} d="M12 8v8" />
        <path {...P} d="M8.6 9.6a4.5 4.5 0 0 0 0 4.8M15.4 9.6a4.5 4.5 0 0 1 0 4.8" />
        <path {...P} d="M6 7a8 8 0 0 0 0 10M18 7a8 8 0 0 1 0 10" />
      </>
    ),
    rotateL: (
      <>
        <path {...P} d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
        <path {...P} d="M3 3v5h5" />
      </>
    ),
    rotateR: (
      <>
        <path {...P} d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
        <path {...P} d="M21 3v5h-5" />
      </>
    ),
    plus: <path {...P} d="M12 5v14M5 12h14" />,
    minus: <path {...P} d="M5 12h14" />,
    recenter: (
      <>
        <circle {...P} cx="12" cy="12" r="3" />
        <path {...P} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
    nfc: (
      <>
        <path {...P} d="M5.5 8a10 10 0 0 1 0 8M9 6a15 15 0 0 1 0 12" />
        <path {...P} d="M13 15V9l4 6V9" />
      </>
    ),
    help: (
      <>
        <circle {...P} cx="12" cy="12" r="9" />
        <path {...P} d="M9.5 9.2a2.5 2.5 0 0 1 4.5 1.5c0 1.6-2 2-2 3.3" />
        {dot(12, 17)}
      </>
    ),
  };
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className={cls} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }}>
      {g[n] || null}
    </svg>
  );
}

// A collapsible section: a Micro-labelled header with a chevron, tucking its
// contents away (collapsed by default). Used to hide the per-game score
// breakdown and the house rules until asked for.
function Accordion({ label, children, open: openInit = false, right }) {
  const [open, setOpen] = useState(openInit);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...plain, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
      >
        <Micro>{label}</Micro>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {right}
          <span style={{ fontSize: 11, color: T.ink30, transition: "transform 200ms ease", transform: open ? "rotate(180deg)" : "none", lineHeight: 1 }}>▾</span>
        </span>
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

// The pill toggle used for on/off house rules.
function Switch({ on }) {
  return (
    <span style={{ width: 42, height: 25, borderRadius: 999, background: on ? T.ink : T.line, position: "relative", flex: "0 0 auto", transition: "background 180ms ease" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 20 : 3, width: 19, height: 19, borderRadius: 999, background: T.bg, transition: "left 180ms ease", boxShadow: "0 1px 2px rgba(18,18,18,0.25)" }} />
    </span>
  );
}

// Home-screen "install this app" affordance. On Android/Chrome it fires the
// captured beforeinstallprompt; if that's dismissed or unavailable (Samsung
// Internet, a throttled prompt) it falls back to the browser-menu steps. iOS
// has no prompt at all, so it always shows the Add-to-Home steps. Hidden once
// installed, on desktop, and inside the artifact.
function InstallPrompt() {
  const [bip, setBip] = useState(typeof window !== "undefined" ? window.__osteriaBIP : null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    const onAvail = () => setBip(window.__osteriaBIP);
    const onDone = () => {
      setBip(null);
      setInstalled(true);
    };
    window.addEventListener("osteria-installable", onAvail);
    window.addEventListener("osteria-installed", onDone);
    return () => {
      window.removeEventListener("osteria-installable", onAvail);
      window.removeEventListener("osteria-installed", onDone);
    };
  }, []);
  if (typeof window === "undefined") return null;
  const nav = window.navigator || {};
  const ua = nav.userAgent || "";
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || nav.standalone === true;
  if (standalone || installed) return null;
  const isIOS = /iP(hone|ad|od)/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const iosSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const isAndroid = /Android/.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  // In-app browsers (a link tapped inside WhatsApp, Instagram, Facebook, TikTok,
  // …) run in a plain WebView: no install prompt ever fires and their menu has
  // no "Install app" — the only way out is to reopen the page in a real browser.
  // The tell is the Android WebView `; wv)` token, plus the known app markers.
  const inApp =
    !bip &&
    (/; wv\)/.test(ua) || // Android System WebView — real Chrome/Samsung never carry this
      /FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Line\/|Snapchat|musical_ly|BytedanceWebview|Twitter|Pinterest/.test(ua));

  if (!bip && !isIOS && !isAndroid) return null; // desktop: nothing to offer

  // Hand the current page to Chrome (Android intent). If Chrome isn't the
  // default this is the reliable way to escape a WebView.
  const openInChrome = () => {
    try {
      const host = location.host,
        path = location.pathname + location.search;
      location.href = `intent://${host}${path}#Intent;scheme=https;package=com.android.chrome;end`;
    } catch {}
  };

  const tap = async () => {
    setNote("");
    if (bip) {
      // Fire the native prompt synchronously inside this gesture, then react.
      try {
        bip.prompt();
        const res = await bip.userChoice;
        setBip(null);
        window.__osteriaBIP = null;
        if (res && res.outcome === "accepted") setNote("Fatto! La trovi nella schermata Home.");
        else setHelp(true);
      } catch {
        setBip(null);
        window.__osteriaBIP = null;
        setHelp(true);
      }
      return;
    }
    if (inApp && isAndroid) {
      openInChrome(); // leave the WebView; the real browser can install
      return;
    }
    setHelp((v) => !v); // no prompt available → show manual steps
  };

  const steps =
    inApp && isAndroid ? (
      <>
        Stai aprendo il gioco <b>dentro un’altra app</b> (WhatsApp, Instagram…), che non può installare.
        Tocca <b>⋮</b> in alto e scegli <b>“Apri in Chrome”</b>, poi da lì <b>“Installa app”</b>.
      </>
    ) : inApp && isIOS ? (
      <>
        Stai aprendo il gioco <b>dentro un’altra app</b>. Tocca <b>⋯</b> e scegli <b>“Apri in Safari”</b>,
        poi <b>Condividi → “Aggiungi a Home”</b>.
      </>
    ) : isIOS ? (
      iosSafari ? (
        <>
          Tocca <b>Condividi</b> <Ico n="share" s={14} style={{ verticalAlign: "-0.2em" }} /> in basso, poi <b>“Aggiungi a Home”</b>.
        </>
      ) : (
        <>
          Apri questa pagina in <b>Safari</b>, poi <b>Condividi → “Aggiungi a Home”</b>.
        </>
      )
    ) : samsung ? (
      <>
        Apri il menu <b>≡</b> del browser, poi <b>“Aggiungi pagina a” → “Schermata Home”</b>.
      </>
    ) : (
      <>
        Apri il menu <b>⋮</b> del browser, poi <b>“Installa app”</b> (o <b>“Aggiungi a schermata Home”</b>).
      </>
    );

  const link = { ...plain, display: "flex", width: "fit-content", alignItems: "center", gap: 6, margin: "14px auto 0", textAlign: "center", color: T.ink, fontWeight: 600 };
  const label = inApp && isAndroid ? "Apri in Chrome per installare" : "Installa l’app";
  const labelIco = inApp && isAndroid ? "exit" : "download";
  // In-app browsers can't install, so lead with the way out rather than a button
  // that would appear to do nothing.
  const showSteps = (help || (inApp && !bip)) && !note;
  return (
    <div style={{ textAlign: "center" }}>
      <button style={link} onClick={tap}>
        <Ico n={labelIco} s={16} /> {label}
      </button>
      {note && <p style={{ color: T.ink, fontSize: 12.5, lineHeight: 1.6, margin: "8px auto 0", maxWidth: 280 }}>{note}</p>}
      {showSteps && <p style={{ color: T.ink60, fontSize: 12.5, lineHeight: 1.6, margin: "8px auto 0", maxWidth: 280 }}>{steps}</p>}
    </div>
  );
}

// Full-screen camera QR scanner (BarcodeDetector). Reads the host's join QR and
// hands back the four-letter code. Falls back to a hint if the camera is denied.
function ScanQR({ onCode, onClose }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stream,
      raf,
      stop = false;
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const v = videoRef.current;
        if (!v || stop) return;
        v.srcObject = stream;
        await v.play().catch(() => {});
        const tick = async () => {
          if (stop) return;
          try {
            const found = await det.detect(v);
            for (const b of found) {
              const t = codeFromScan(b.rawValue);
              if (t) {
                onCode(t);
                return;
              }
            }
          } catch {}
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setErr("Consenti l’accesso alla fotocamera, poi riprova.");
      }
    })();
    return () => {
      stop = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, transparent 120px, rgba(0,0,0,0.55) 190px)" }} />
      <div style={{ position: "relative", width: 220, height: 220, borderRadius: 22, boxShadow: "0 0 0 3px rgba(255,255,255,0.9)", maxWidth: "70vw" }} />
      <div style={{ position: "absolute", top: "calc(50% + 140px)", left: 0, right: 0, textAlign: "center", color: "#fff", fontFamily: BRAND, fontWeight: 600, fontSize: 16, padding: "0 24px" }}>
        {err || "Inquadra il QR dell’altro telefono"}
      </div>
      <button
        onClick={onClose}
        style={{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom))", background: "#fff", color: "#111", border: "none", borderRadius: 12, padding: "13px 26px", fontFamily: BRAND, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
      >
        Chiudi
      </button>
    </div>
  );
}

// A big shaking "Scopa!" across the middle of the table when someone clears it.
function ScopaFlash({ id }) {
  if (!id) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <div
        key={id}
        className="scopaflash"
        style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(66px, 23vw, 150px)", color: "#A5342F", letterSpacing: "-0.03em", textShadow: "0 6px 0 rgba(18,18,18,0.10)", whiteSpace: "nowrap" }}
      >
        Scopa<span style={{ color: T.ink }}>!</span>
      </div>
    </div>
  );
}

// The running head-to-head between the two players at this table, big on the
// games page, with a per-game breakdown. Reads the locally-kept board.
function Scoreboard({ board, names }) {
  const nA = names.A,
    nB = names.B;
  if (!nA || !nB) return null;
  const rec = board[pairKey(nA, nB)];
  const kA = nrm(nA),
    kB = nrm(nB);
  const games = rec ? Object.keys(rec.byGame).filter((g) => GAMES[g]) : [];
  const wins = (k) => games.reduce((s, g) => s + (rec.byGame[g][k] || 0), 0);
  const wA = wins(kA),
    wB = wins(kB);
  const RED = "#A5342F";
  const big = (n, hi) => (
    <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 54, lineHeight: 1, color: hi ? RED : T.ink }}>{n}</span>
  );
  const nameStyle = (align) => ({ flex: 1, textAlign: align, fontFamily: BRAND, fontWeight: 600, fontSize: 16, color: T.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
  return (
    <div>
      <Micro style={{ textAlign: "center" }}>Testa a testa</Micro>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 6 }}>
        <div style={nameStyle("right")}>{nA}</div>
        {big(wA, wA > wB)}
        <span style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 24, color: T.ink30 }}>–</span>
        {big(wB, wB > wA)}
        <div style={nameStyle("left")}>{nB}</div>
      </div>
      {games.length ? (
        <div style={{ marginTop: 10 }}>
          <Accordion label="Per gioco">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {games.map((g) => {
                const a = rec.byGame[g][kA] || 0,
                  b = rec.byGame[g][kB] || 0;
                return (
                  <div key={g} style={{ display: "flex", justifyContent: "space-between", fontFamily: BRAND, fontSize: 14, color: T.ink60 }}>
                    <span>{GAMES[g].name}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      <span style={{ color: a > b ? RED : T.ink }}>{a}</span>
                      <span style={{ color: T.ink30 }}> – </span>
                      <span style={{ color: b > a ? RED : T.ink }}>{b}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Accordion>
        </div>
      ) : (
        <Micro style={{ textAlign: "center", marginTop: 8 }}>prima sfida — che vinca il migliore</Micro>
      )}
    </div>
  );
}

// Solo-test control: one device plays both seats; tap to switch which side you
// are, so you can drive the whole game yourself.
function SoloBar({ seat, names, onFlip }) {
  return (
    <button
      onClick={onFlip}
      style={{ width: "100%", background: "rgba(18,18,18,0.05)", border: `1px dashed ${T.ink30}`, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontFamily: BRAND, fontWeight: 600, fontSize: 13, color: T.ink, cursor: "pointer", display: "flex", justifyContent: "center", gap: 8, alignItems: "center", WebkitTapHighlightColor: "transparent" }}
    >
      <Ico n="flask" s={14} /> Solo · sei {names[seat] || seat} — tocca per passare all’altro
    </button>
  );
}

// A simple titled bottom-of-mind modal sheet, dismissed by tapping outside.
function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 82, background: SCRIM, display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 18, padding: "20px 20px 16px", maxWidth: 360, width: "100%", boxShadow: "0 24px 60px rgba(18,18,18,0.35)" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 19, color: T.ink, marginBottom: 12 }}>{title}</div>
        {children}
        <button onClick={onClose} style={{ ...plain, color: T.ink, fontWeight: 600, marginTop: 14, display: "block", width: "100%", textAlign: "center", padding: "8px 0" }}>
          Chiudi
        </button>
      </div>
    </div>
  );
}

// Bump waiting overlay — the pieces shake harder and the phone buzzes harder as
// the ~3s match window fills, building to the bump.
function BumpVeil({ show, onCancel }) {
  const [off, setOff] = useState({ x: 0, y: 0, r: 0 });
  useEffect(() => {
    if (!show || typeof window === "undefined") return;
    let raf,
      start = performance.now(),
      lastBuzz = 0;
    const loop = (now) => {
      const p = Math.min(1, (now - start) / 3000); // 0 → 1 over the window
      const mag = 1.5 + p * p * 13;
      setOff({ x: (Math.random() * 2 - 1) * mag, y: (Math.random() * 2 - 1) * mag * 0.5, r: (Math.random() * 2 - 1) * p * 5 });
      if (now - lastBuzz > 190 - p * 150) {
        lastBuzz = now;
        try {
          navigator.vibrate?.(Math.round(6 + p * p * 45));
        } catch {}
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      try {
        navigator.vibrate?.(0);
      } catch {}
    };
  }, [show]);
  if (!show) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(231,229,224,0.94)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 320, transform: `translate(${off.x}px, ${off.y}px) rotate(${off.r}deg)` }}>
        <div><Ico n="bump" s={44} c={T.ink} sw={1.6} /></div>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: T.ink, marginTop: 12 }}>Bump!</div>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.55, margin: "8px 0 18px" }}>Avvicinate i telefoni e premete Bump insieme.</p>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
          <span className="recdot" style={{ animationDelay: "0ms" }} />
          <span className="recdot" style={{ animationDelay: "140ms" }} />
          <span className="recdot" style={{ animationDelay: "280ms" }} />
        </div>
        <Button kind="line" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </div>
  );
}

// A gentle "are you sure" before leaving a table — losing a hand to a stray
// thumb is exactly what this game set out to prevent. Warm, osteria-flavoured.
function LeaveDialog({ show, onStay, onGo }) {
  if (!show) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: SCRIM, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 18, padding: "26px 22px 20px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 20px 50px rgba(18,18,18,0.3)" }}>
        <div><Ico n="wine" s={32} c={T.ink} sw={1.6} /></div>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: T.ink, marginTop: 8 }}>Già ti alzi dal tavolo?</div>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.55, margin: "8px 0 20px" }}>
          La mano è ancora calda e il tuo posto è caldo pure lui. Se esci lasci le carte all’oste — e l’oste bara.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Button full onClick={onStay}>
            Resto a giocare
          </Button>
          <button onClick={onGo} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
            Esco lo stesso
          </button>
        </div>
      </div>
    </div>
  );
}

// The end-of-game screen as a modal over everything: Vittoria / Sconfitta /
// Pareggio (or the mid-match "Punteggio"), the score summary, and the two
// ways on — play again or back to the games.
function FinaleModal({ show, decided, outcome, room, gs, seat, onAgain, onExit }) {
  if (!show) return null;
  const isHost = seat === "A";
  const nextLabel = scopaLike(room.game) && !gs.matchDone ? "Prossima mano" : "Gioca ancora";
  const win = outcome === "win";
  const draw = outcome === "draw";
  const head = !decided ? "Punteggio" : win ? "Vittoria!" : draw ? "Pareggio" : "Sconfitta";
  const color = !decided ? T.ink : win ? "#B8862B" : draw ? T.ink60 : "#A5342F";
  const sub = !decided ? null : win ? "Offre l’oste" : draw ? "Pari e patta — nessuno paga" : "Ci sta una rivincita.";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: SCRIM, display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div className="fade" style={{ position: "relative", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 20, padding: "22px 20px", maxWidth: 360, width: "100%", boxShadow: "0 24px 60px rgba(18,18,18,0.35)", overflow: "hidden" }}>
        {decided && win && <Confetti />}
        <div className="pop" style={{ position: "relative", textAlign: "center", fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(40px, 13vw, 66px)", lineHeight: 0.98, color, letterSpacing: "-0.01em" }}>
          {head}
        </div>
        {sub && <p style={{ textAlign: "center", color: T.ink60, fontSize: 14, margin: "6px 0 0" }}>{sub}</p>}
        <div style={{ marginTop: 14 }}>
          <Summary room={room} gs={gs} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {isHost ? (
            <Button full onClick={onAgain}>
              {nextLabel}
            </Button>
          ) : (
            <Micro style={{ textAlign: "center" }}>distribuisce {room.names.A}…</Micro>
          )}
          <button onClick={onExit} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
            Torna ai giochi
          </button>
        </div>
      </div>
    </div>
  );
}

// "End the game?" hand-off. The one who tapped Esci waits; the other is asked to
// agree. Agreeing sends both back to the game-selection lobby.
function EndGameOverlay({ room, seat, onAgree, onDecline, onCancel }) {
  const req = room.endReq;
  if (!req) return null;
  const mineReq = req.by === seat;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 78, background: SCRIM, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 18, padding: "24px 22px 20px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 20px 50px rgba(18,18,18,0.3)" }}>
        {mineReq ? (
          <>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 20, color: T.ink }}>Aspetto {who(room, other(seat))}…</div>
            <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px 0 16px" }}>Hai chiesto di chiudere la partita. Deve dire di sì anche l’altro.</p>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18 }}>
              <span className="recdot" style={{ animationDelay: "0ms" }} />
              <span className="recdot" style={{ animationDelay: "140ms" }} />
              <span className="recdot" style={{ animationDelay: "280ms" }} />
            </div>
            <Button kind="line" full onClick={onCancel}>
              Annulla
            </Button>
          </>
        ) : (
          <>
            <div><Ico n="exit" s={30} c={T.ink} sw={1.6} /></div>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 21, color: T.ink, marginTop: 6 }}>{who(room, req.by)} vuole smettere</div>
            <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px 0 18px" }}>Chiudete qui e tornate a scegliere un gioco?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Button full onClick={onAgree}>
                Sì, ai giochi
              </Button>
              <button onClick={onDecline} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
                No, continuiamo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Full-screen veil while the socket is down — auto-reconnect runs underneath,
// with a manual retry in case focus events never fire.
function ReconnectVeil({ show, busy, onRetry }) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(231,229,224,0.86)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18 }}>
          <span className="recdot" style={{ animationDelay: "0ms" }} />
          <span className="recdot" style={{ animationDelay: "140ms" }} />
          <span className="recdot" style={{ animationDelay: "280ms" }} />
        </div>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 20, color: T.ink }}>Riconnessione…</div>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px 0 20px" }}>Connessione persa. Riprendo il tavolo appena torna la rete.</p>
        <Button full soft={busy} onClick={onRetry}>
          {busy ? "Riconnetto…" : "Riconnetti ora"}
        </Button>
      </div>
    </div>
  );
}

/* A bottom-pinned action strip, centred to the same 480 column as the app and
   painted in the app's own paper-grey — a hairline, not a floating white card.
   Reused by any board that keeps its controls in reach of the thumb. */
function FloatBar({ children }) {
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          pointerEvents: "auto",
          background: T.bg,
          borderTop: `1px solid ${T.line}`,
          padding: "12px 16px calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
    </div>
  );
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
@keyframes recbob{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-6px);opacity:1}}
.recdot{width:9px;height:9px;border-radius:50%;background:${T.ink};display:inline-block;animation:recbob 1s ease-in-out infinite}
@keyframes deckbob{0%,100%{transform:rotateX(26deg) translateZ(0)}50%{transform:rotateX(23deg) translateZ(4px)}}
.deckbob{animation:deckbob 3.6s ease-in-out infinite}
@keyframes freshpulse{0%{box-shadow:0 0 0 2px #2C557E,0 0 0 0 rgba(44,85,126,.5)}40%{box-shadow:0 0 0 2px #2C557E,0 0 16px 3px rgba(44,85,126,.55)}100%{box-shadow:0 0 0 2px #2C557E,0 4px 11px rgba(44,85,126,.42)}}
.freshcard{animation:freshpulse 900ms ease-out}
@keyframes scopaflash{0%{transform:scale(.3) rotate(-9deg);opacity:0}15%{transform:scale(1.14) rotate(3deg);opacity:1}27%{transform:scale(1) rotate(-3deg)}39%{transform:rotate(3deg)}51%{transform:rotate(-2.5deg)}63%{transform:rotate(2deg)}75%{transform:rotate(-1.5deg)}86%{transform:scale(1) rotate(0);opacity:1}100%{transform:scale(1.06);opacity:0}}
.scopaflash{animation:scopaflash 1500ms cubic-bezier(.2,.9,.25,1) both}
@keyframes flypR{0%{transform:translate(0,0) scale(1);opacity:1}14%{transform:translate(0,-5px) scale(1.06)}100%{transform:translate(150px,56px) scale(.4);opacity:0}}
@keyframes flypL{0%{transform:translate(0,0) scale(1);opacity:1}14%{transform:translate(0,-5px) scale(1.06)}100%{transform:translate(-150px,56px) scale(.4);opacity:0}}
.flypR{animation:flypR 640ms cubic-bezier(.4,0,.5,1) forwards}
.flypL{animation:flypL 640ms cubic-bezier(.4,0,.5,1) forwards}
@keyframes tumble{0%{transform:rotate(-10deg) scale(.6);opacity:0}12%{opacity:1}30%{transform:rotate(12deg) scale(1.12)}55%{transform:rotate(-8deg) scale(1.02)}75%{transform:rotate(6deg) scale(1.05)}100%{transform:rotate(0) scale(1)}}
.tumble{animation:tumble 620ms cubic-bezier(.2,.8,.3,1) both}
@keyframes settle{0%{transform:scale(1.5);opacity:0}45%{transform:scale(.9);opacity:1}72%{transform:scale(1.08)}100%{transform:scale(1)}}
.settle{animation:settle 440ms cubic-bezier(.2,1.4,.4,1) both}
@keyframes critshake{0%,100%{transform:translate(0,0)}18%{transform:translate(-4px,2px) rotate(-2deg)}38%{transform:translate(4px,-2px) rotate(2deg)}58%{transform:translate(-3px,1px)}78%{transform:translate(3px,-1px)}}
.critshake{animation:critshake 460ms ease-in-out}
@keyframes hexpulse{0%,100%{opacity:.35}50%{opacity:.7}}
.hexpulse{animation:hexpulse 1.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.slam,.jolt,.fade,.deal,.turn,.swap,.pop,.confetti,.flipy,.floaty,.dieroll,.recdot,.deckbob,.scopaflash,.flypR,.flypL,.tumble,.settle,.critshake,.hexpulse{animation:none!important}}
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
  const [scopaFlash, setScopaFlash] = useState(0);
  const [booting, setBooting] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [bumping, setBumping] = useState(false); // waiting in the bump lobby
  const [scanning, setScanning] = useState(false); // camera QR scanner open
  const [board, setBoard] = useState({}); // local head-to-head record between name pairs
  const bumpRef = useRef(null);
  const boardRef = useRef({});
  boardRef.current = board;
  useEffect(() => {
    loadBoard().then((b) => {
      boardRef.current = b || {};
      setBoard(b || {});
    });
  }, []);

  const roomRef = useRef(null);
  const netRef = useRef(null);
  const relayRef = useRef(false);
  const reconnectingRef = useRef(false);
  const seenAnim = useRef(null);
  const soundRef = useRef(true);
  const seatRef = useRef("A");
  const typedName = useRef(false); // did the user type their name (vs it coming from prefs)?
  const deepJoined = useRef(false);
  const deepRef = useRef(undefined);
  const soloRef = useRef(false);
  if (deepRef.current === undefined) {
    try {
      const q = new URLSearchParams(location.search);
      const t = (q.get("t") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      deepRef.current = t.length === 4 ? t : null;
      soloRef.current = q.has("solo") || q.has("test");
    } catch {
      deepRef.current = null;
    }
  }
  const [solo, setSolo] = useState(false); // one device drives both seats — for testing
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

  /* ── don't replay an animation that was already baked into the state we
     joined or restored into (e.g. the last scopa of a persisted hand) ── */
  const animArmed = useRef(false);
  useEffect(() => {
    if (animArmed.current || !room) return;
    animArmed.current = true;
    seenAnim.current = room.anim?.id ?? null;
  }, [room]);

  /* ── animation trigger, local and remote ── */
  useEffect(() => {
    const a = room?.anim;
    if (!a || a.id === seenAnim.current) return;
    seenAnim.current = a.id;
    setSlamId(a.card || null);
    setJolt(true);
    slamSound(a.kind, soundRef.current);
    buzz(a.kind);
    const timers = [setTimeout(() => setJolt(false), 200), setTimeout(() => setSlamId(null), 460)];
    // A cleared table in scopa gets a big shaking "Scopa!" on both screens.
    if (scopaLike(room.game) && room.ev && room.ev.t === "scopa") {
      setScopaFlash((n) => n + 1);
      timers.push(setTimeout(() => setScopaFlash(0), 1500));
    }
    return () => timers.forEach(clearTimeout);
  }, [room?.anim?.id]);

  /* ── the finale, from this seat's point of view ── */
  const fgs = room?.gs;
  const decided = !!(fgs && fgs.done && (scopaLike(room.game) ? fgs.matchDone : true));
  const winnerSeat =
    !fgs || !fgs.done
      ? null
      : scopaLike(room.game)
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
    // Record the match into the local head-to-head board (not in solo tests).
    if (winnerSeat && !solo && room?.names?.A && room?.names?.B) {
      const nb = recordWin(boardRef.current, room.names.A, room.names.B, room.names[winnerSeat], room.game);
      boardRef.current = nb;
      setBoard(nb);
      saveBoard(nb);
    }
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
      const peer = new Peer(host ? id : undefined, { debug: 0, config: { iceServers: ICE_SERVERS } });
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
  const openTable = async (preCode) => {
    // preCode is only a real 4-letter code from the bump flow; when this is a
    // button handler React passes the click event, so ignore anything non-string.
    const code = (typeof preCode === "string" && preCode) || Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
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

  // Solo test: a local two-seat table on one device, no network. `publish`
  // already updates local state and just no-ops on the null transport, so the
  // tester flips sides with the seat toggle and plays both hands.
  const openSolo = () => {
    const code = "SOLO";
    const fresh = {
      code,
      v: 0,
      ts: Date.now(),
      names: { A: name.trim() || "Uno", B: "Due" },
      status: "lobby",
      game: "scopa",
      opts: { ...GAMES.scopa.def, ...(savedRules.scopa || {}) },
      scores: showScores,
      gs: null,
      log: [],
      ev: null,
      anim: null,
    };
    netRef.current = null;
    setSolo(true);
    setSeat("A");
    roomRef.current = fresh;
    setRoom(fresh);
    setLink("live");
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

  // Bump: both phones tap Bump; the lobby pairs them into a fresh table.
  const bump = () => {
    if (hasStore()) return setMsg("Il bump funziona solo online.");
    if (bumpRef.current) return;
    setMsg("");
    setBumping(true);
    // Grab a rough location (best-effort) so the lobby can match by proximity,
    // then open the socket. Whether or not location comes back, the match window
    // is short — both must bump within a few seconds.
    const connect = (coords) => {
      if (!bumpRef.current && bumpRef.current !== "pending") return; // cancelled while locating
      let ws;
      try {
        ws = new WebSocket(bumpUrl(coords));
      } catch {
        setBumping(false);
        return setMsg("Bump non disponibile.");
      }
      bumpRef.current = ws;
      const timer = setTimeout(() => {
        if (bumpRef.current === ws) {
          try {
            ws.close();
          } catch {}
          bumpRef.current = null;
          setBumping(false);
          setMsg("Nessuno vicino ha bumpato. Riprova insieme.");
        }
      }, 3200);
      ws.onmessage = (e) => {
        let d;
        try {
          d = JSON.parse(e.data);
        } catch {
          return;
        }
        if (d.type === "paired" && d.code) {
          clearTimeout(timer);
          bumpRef.current = null;
          try {
            ws.close();
          } catch {}
          try {
            navigator.vibrate?.([40, 30, 90]);
          } catch {}
          setBumping(false);
          if (d.host) openTable(d.code);
          else {
            setCodeIn(d.code);
            joinTable(d.code);
          }
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (bumpRef.current === ws) {
          bumpRef.current = null;
          setBumping(false);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        bumpRef.current = null;
        setBumping(false);
        setMsg("Bump non disponibile.");
      };
    };
    bumpRef.current = "pending";
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => connect({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => connect(null),
        { enableHighAccuracy: false, timeout: 2000, maximumAge: 60000 }
      );
    } else connect(null);
  };
  const cancelBump = () => {
    const ws = bumpRef.current;
    bumpRef.current = null;
    if (ws && ws !== "pending") {
      try {
        ws.close();
      } catch {}
    }
    setBumping(false);
  };

  const leave = () => {
    dropSession();
    netRef.current?.close();
    netRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setPick(null);
    setMsg("");
    setSolo(false);
    setScreen("home");
  };
  // Back to game selection, keeping the table and both players.
  const toGames = () => publish({ ...room, status: "lobby", gs: null, log: [], ev: null, endReq: null });
  // Esci mid-game: solo just returns to the lobby; online asks the other player.
  const requestEnd = () => (solo || !room.names.B ? toGames() : publish({ ...room, endReq: { by: seat } }));
  const agreeEnd = () => toGames();
  const declineEnd = () => publish({ ...room, endReq: null });

  /* ── reconnect without a reload ──────────────────────────────────────
     A phone that sleeps or backgrounds the tab drops the socket. Rather than
     stranding the player on a dead "disconnesso", we re-open the transport in
     place — automatically when the window regains focus, or from the veil's
     button — and let the Durable Object replay the stored hand. */
  const reconnect = useCallback(async () => {
    const cur = roomRef.current;
    if (reconnectingRef.current || !cur) return;
    reconnectingRef.current = true;
    setReconnecting(true);
    setLink("waiting");
    try {
      netRef.current?.close?.();
    } catch {}
    const code = cur.code;
    const host = seatRef.current === "A";
    const nm = cur.names?.[seatRef.current] || "";
    let ok = false;
    if (hasStore()) {
      openStorage(code);
      ok = true;
    } else {
      ok = await openRelay(code, host, nm);
      if (!ok) {
        try {
          await openPeer(code, host, nm);
          ok = true;
        } catch {
          ok = false;
        }
      }
    }
    // the host re-pushes the current hand so a reconnecting guest re-syncs
    if (ok && host) setTimeout(() => netRef.current?.send(roomRef.current), relayRef.current ? 250 : 900);
    if (!ok) setLink("lost");
    reconnectingRef.current = false;
    setReconnecting(false);
  }, [openRelay, openPeer, openStorage]);

  useEffect(() => {
    if (booting || !room) return;
    const tryReconnect = () => {
      if (document.visibilityState !== "hidden" && !reconnectingRef.current && (link === "lost" || link === "waiting")) reconnect();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") tryReconnect();
    };
    window.addEventListener("focus", tryReconnect);
    window.addEventListener("online", tryReconnect);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", tryReconnect);
      window.removeEventListener("online", tryReconnect);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [booting, room, link, reconnect]);

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
      // `quiet` moves (shuffling your hand, signalling ready) carry no slam.
      anim: res.quiet ? null : { id: uid(), kind: res.kind, card: res.card?.id, seat },
    });
  };

  // The host picks the game and its house rules in the lobby, before anything is
  // dealt; both are synced so the guest sees the table being set. Dealing just
  // flips the room to play with whatever is already staged in room.game/opts.
  const pickGame = (game) => publish({ ...room, game, opts: { ...GAMES[game].def, ...(savedRules[game] || {}) } });

  // Deal a game from an ordered deck (either RNG or the one the players shuffled
  // and cut). `cont` carries running scores/tally into the next game.
  const dealGame = (game, o, dealer, cont, deck) =>
    scopaLike(game)
      ? dealScopa(dealer, cont?.scores || null, o, deck)
      : game === "ruba"
      ? dealRuba(dealer, cont?.tally || null, deck)
      : game === "briscola"
      ? dealBriscola(dealer, cont?.tally || null, deck)
      : game === "perudo"
      ? dealPerudo(dealer, cont?.tally || null)
      : game === "yahtzee"
      ? dealYahtzee(dealer, cont?.tally || null)
      : game === "scala"
      ? dealScala(dealer, cont?.tally || null)
      : game === "peppa"
      ? dealPeppa(dealer, cont?.tally || null)
      : game === "condottieri"
      ? dealTactics(dealer, o, cont?.tally || null)
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

  const start = () => (usesRitual(room.game) ? beginPrepare("A", null) : dealNow(dealGame(room.game, room.opts, "A", null)));
  const again = () => {
    const g = room.gs;
    // Scopa runs the shuffle-and-cut ritual before every hand — mid-match the
    // dealer alternates and the running scores carry over; a finished match
    // starts fresh from seat A.
    if (scopaLike(room.game)) beginPrepare(g.matchDone ? "A" : other(g.dealer), g.matchDone ? null : { scores: g.scores });
    else if (usesRitual(room.game)) beginPrepare(other(g.dealer), { tally: g.tally });
    else if (GAMES[room.game].big || GAMES[room.game].instant) dealNow(dealGame(room.game, room.opts, other(g.dealer), { tally: g.tally })); // scala, peppa
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
              <Button full onClick={() => openTable()}>
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

            {/* quick-pair shortcuts */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 20px", marginTop: 14 }}>
              {!hasStore() && (
                <button onClick={bump} style={{ ...plain, color: T.ink, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Ico n="bump" s={16} /> Bump
                </button>
              )}
              {hasScanner() && (
                <button onClick={() => setScanning(true)} style={{ ...plain, color: T.ink, fontWeight: 600 }}>
                  ▣ Inquadra un QR
                </button>
              )}
              {hasNfc() && (
                <button onClick={readNfc} style={{ ...plain, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Ico n="nfc" s={15} /> Tag NFC
                </button>
              )}
            </div>

            {/* Testing only: hidden behind the ?solo (or ?test) link, so ordinary
                visitors never see it. Opens a local two-seat table you drive from
                one device, flipping sides with the toggle up top. */}
            {soloRef.current && (
              <button
                onClick={openSolo}
                style={{ ...plain, display: "flex", width: "fit-content", alignItems: "center", gap: 6, margin: "16px auto 0", color: T.ink, fontWeight: 600, fontSize: 13.5 }}
              >
                <Ico n="flask" s={15} /> Prova da solo <span style={{ color: T.ink30, fontWeight: 400 }}>· due lati, un telefono</span>
              </button>
            )}
            {msg && <p style={{ color: T.ink, fontSize: 13, marginTop: 12, textAlign: "center" }}>{msg}</p>}
            {!hasStore() && <InstallPrompt />}
          </div>
        </div>
        <BumpVeil show={bumping} onCancel={cancelBump} />
        {scanning && (
          <ScanQR
            onClose={() => setScanning(false)}
            onCode={(t) => {
              setScanning(false);
              setCodeIn(t);
              joinTable(t);
            }}
          />
        )}
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
        <ReconnectVeil show={link === "lost" || reconnecting} busy={reconnecting} onRetry={reconnect} />
        <Head room={room} link={link} onLeave={() => setAskLeave(true)} onReconnect={reconnect} sound={sound} setSound={setSound} title="Al tavolo" />
        {solo && <SoloBar seat={seat} names={room.names} onFlip={() => setSeat(other(seat))} />}
        <LeaveDialog show={askLeave} onStay={() => setAskLeave(false)} onGo={leave} />
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

          {seated && (
            <div style={{ marginTop: 16 }}>
              <Scoreboard board={board} names={room.names} />
            </div>
          )}

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
            <div style={{ marginTop: 20 }}>
              <Accordion label={`Regole della casa${host ? "" : " · le sceglie l’host"}`}>
                <RuleChips conf={g} opts={room.opts} setOpt={host ? setOpt : null} />
              </Accordion>
            </div>
          )}

          {usesRitual(room.game) && (
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
        <ReconnectVeil show={link === "lost" || reconnecting} busy={reconnecting} onRetry={reconnect} />
        <Head room={room} link={link} onLeave={() => setAskLeave(true)} onReconnect={reconnect} sound={sound} setSound={setSound} title="Prepara il mazzo" />
        {solo && <SoloBar seat={seat} names={room.names} onFlip={() => setSeat(other(seat))} />}
        <LeaveDialog show={askLeave} onStay={() => setAskLeave(false)} onGo={leave} />
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
      <ReconnectVeil show={link === "lost" || reconnecting} busy={reconnecting} onRetry={reconnect} />
      <ScopaFlash id={scopaFlash} />
      <Head room={room} link={link} onLeave={requestEnd} onReconnect={reconnect} sound={sound} setSound={setSound} title={conf.name} />
      {solo && <SoloBar seat={seat} names={room.names} onFlip={() => setSeat(other(seat))} />}
      <EndGameOverlay room={room} seat={seat} onAgree={agreeEnd} onDecline={declineEnd} onCancel={declineEnd} />
      <FinaleModal show={gs.done} decided={decided} outcome={outcome} room={room} gs={gs} seat={seat} onAgain={again} onExit={toGames} />

      {room.game === "camicia" ? (
        <Camicia room={room} gs={gs} seat={seat} mine={mine} slamId={slamId} commit={commit} showScores={!!room.scores} />
      ) : room.game === "briscola" ? (
        <Briscola room={room} gs={gs} seat={seat} opp={opp} mine={mine} slamId={slamId} commit={commit} showScores={!!room.scores} />
      ) : room.game === "perudo" ? (
        <Perudo room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "yahtzee" ? (
        <Yahtzee room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "scala" ? (
        <Scala room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "peppa" ? (
        <Peppa room={room} gs={gs} seat={seat} mine={mine} slamId={slamId} commit={commit} />
      ) : room.game === "condottieri" ? (
        <Tactics room={room} gs={gs} seat={seat} commit={commit} />
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

      {room.ev && !gs.done && isCard(room.game) && room.game !== "scala" && room.game !== "condottieri" && (
        <p style={{ color: T.ink60, fontSize: 12, textAlign: "center", marginTop: 14, minHeight: 16 }}>
          {who(room, room.ev.seat)} {describe(room.ev, french)}
        </p>
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

function Head({ room, link, onLeave, onReconnect, title, sound, setSound }) {
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
          <button onClick={() => (onReconnect ? onReconnect() : window.location.reload())} style={{ ...plain, color: T.ink, fontWeight: 700 }}>
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
  // Cycling values (the point target) read as tap-to-change tiles with the
  // value shown big; on/off rules read as labelled switch rows underneath —
  // two clearly different affordances, each with its plain-language hint.
  const cyc = conf.opts.filter((o) => !isToggleOpt(o));
  const tog = conf.opts.filter((o) => isToggleOpt(o));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {cyc.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {cyc.map((o) => {
            const cur = opts[o.k];
            const i = o.cycle.indexOf(cur);
            const next = o.cycle[(i + 1) % o.cycle.length];
            return (
              <button
                key={o.k}
                onClick={setOpt ? () => setOpt(o.k, next) : undefined}
                disabled={!setOpt}
                title={o.hint}
                style={{ border: `1.5px solid ${T.ink}`, background: "transparent", borderRadius: 12, padding: "8px 14px", cursor: setOpt ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 84, WebkitTapHighlightColor: "transparent" }}
              >
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink60 }}>{o.label}</span>
                <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 24, color: T.ink, lineHeight: 1 }}>{String(cur)}</span>
              </button>
            );
          })}
        </div>
      )}
      {tog.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {tog.map((o, idx) => {
            const on = opts[o.k] === true;
            return (
              <button
                key={o.k}
                onClick={setOpt ? () => setOpt(o.k, !on) : undefined}
                disabled={!setOpt}
                title={o.hint}
                style={{ ...plain, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 0", textAlign: "left", cursor: setOpt ? "pointer" : "default", borderTop: idx ? `1px solid ${T.line}` : "none", WebkitTapHighlightColor: "transparent" }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: BRAND, fontWeight: 600, fontSize: 15, color: on ? T.ink : T.ink60 }}>{o.label}</span>
                  {o.hint && <span style={{ display: "block", fontSize: 12, color: T.ink30, marginTop: 2, lineHeight: 1.3 }}>{o.hint}</span>}
                </span>
                <Switch on={on} />
              </button>
            );
          })}
        </div>
      )}
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

/* ── scopa / rubamazzo board ── */
function Board({ room, gs, seat, opp, mine, slamId, pick, setPick, commit, showScores }) {
  const isScopa = scopaLike(room.game);
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
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
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

      {/* table — grows to fill the middle */}
      <div style={{ flex: 1, margin: "18px 0", minHeight: 108, display: "flex", flexDirection: "column", justifyContent: "center" }}>
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
        <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 84 }}>
          {/* a captured card flies off toward the winning player's pila */}
          {taken && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 4 }}>
              <div key={a.id} className={a.seat === seat ? "flypR" : "flypL"}>
                <Card card={taken} size="sm" rot={0} />
              </div>
            </div>
          )}
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
              const stealsum = !isScopa && opt.type === "stealsum";
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
                    <>
                      {gs.table.filter((c) => ids.includes(c.id)).map((c) => (
                        <Card key={c.id} card={c} size="sm" rot={0} />
                      ))}
                      {stealsum && (
                        <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 6 }}>+ ruba il mazzo ({gs.piles[other(seat)].length})</span>
                      )}
                    </>
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
        <div style={{ display: "flex", gap: gs.hands[seat].length > 3 ? 5 : 8, justifyContent: "center", minHeight: 96, flexWrap: "wrap" }}>
          {gs.hands[seat].map((c) => (
            <Card
              key={c.id}
              card={c}
              size={gs.hands[seat].length > 3 ? "md" : "lg"}
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

/* ── peppa tencia (old maid) ── */
// A fanned hand with animated positions. `mode` decides interaction:
//  · "arrange" — drag a card sideways to reorder, or up to raise it as an offer
//  · "draw"    — tap a (face-down) card to draw it
//  · "watch"   — static, but every card animates to its slot, so the other
//                player sees your shuffles, drags and offers happen live
function PeppaHand({ cards, faceUp, mode, offerId, onReorder, onOffer, onDraw, slamId }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const measure = () => wrapRef.current && setW(wrapRef.current.clientWidth || 320);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const startRef = useRef(null);

  const n = cards.length;
  const CW = 36,
    CH = 52; // xs card
  const STEP = n > 1 ? Math.min(CW + 8, (w - CW) / (n - 1)) : 0;
  const total = CW + (n - 1) * STEP;
  const offX = Math.max(0, (w - total) / 2);
  const RAISE = 26; // resting drop, so an offered card can rise above the row
  const H = CH + RAISE + 10;
  const order = cards.map((c) => c.id);

  let visual = order;
  if (drag) {
    visual = order.filter((id) => id !== drag.id);
    const li = Math.max(0, Math.min(order.length - 1, Math.round(drag.i0 + drag.dx / (STEP || 1))));
    visual.splice(li, 0, drag.id);
  }

  const pt = (e) => (e.touches && e.touches[0] ? e.touches[0] : e);
  const down = (e, card, i) => {
    if (mode !== "arrange") return;
    const p = pt(e);
    startRef.current = { x: p.clientX, y: p.clientY };
    dragRef.current = { id: card.id, i0: i, dx: 0, dy: 0 };
    setDrag(dragRef.current);
  };
  const move = (e) => {
    if (!dragRef.current) return;
    const p = pt(e);
    const d = { ...dragRef.current, dx: p.clientX - startRef.current.x, dy: p.clientY - startRef.current.y };
    dragRef.current = d;
    setDrag(d);
  };
  const up = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.dy < -34) {
      onOffer && onOffer(d.id); // flicked up → offer / un-offer
      return;
    }
    const li = Math.max(0, Math.min(n - 1, Math.round(d.i0 + d.dx / (STEP || 1))));
    if (li !== d.i0) onReorder && onReorder(d.id, li);
  };

  return (
    <div
      ref={wrapRef}
      onTouchMove={mode === "arrange" ? move : undefined}
      onTouchEnd={mode === "arrange" ? up : undefined}
      onMouseMove={mode === "arrange" ? move : undefined}
      onMouseUp={mode === "arrange" ? up : undefined}
      onMouseLeave={mode === "arrange" ? up : undefined}
      style={{ position: "relative", height: H, width: "100%", touchAction: mode === "arrange" ? "none" : "auto", userSelect: "none", WebkitUserSelect: "none" }}
    >
      {n === 0 && <Micro style={{ position: "absolute", left: "50%", top: 22, transform: "translateX(-50%)" }}>mano vuota</Micro>}
      {cards.map((c) => {
        const id = c.id;
        const isDragged = drag && drag.id === id;
        const vi = visual.indexOf(id);
        const offered = offerId === id;
        const left = isDragged ? offX + drag.i0 * STEP + drag.dx : offX + vi * STEP;
        const top = isDragged ? RAISE + drag.dy : offered ? 0 : RAISE;
        const idx = order.indexOf(id); // draw index = position in the real array
        return (
          <div
            key={id}
            onMouseDown={mode === "arrange" ? (e) => down(e, c, idx) : undefined}
            onTouchStart={mode === "arrange" ? (e) => down(e, c, idx) : undefined}
            onClick={mode === "draw" ? () => onDraw && onDraw(idx) : undefined}
            style={{
              position: "absolute",
              left,
              top,
              zIndex: isDragged ? 60 : offered ? 40 : vi,
              transition: isDragged ? "none" : "left 240ms cubic-bezier(.2,.9,.25,1), top 200ms ease",
              cursor: mode === "draw" ? "pointer" : mode === "arrange" ? "grab" : "default",
              WebkitTapHighlightColor: "transparent",
            }}
            className={mode === "draw" && offered ? "freshpulse" : ""}
          >
            {faceUp ? <Card card={c} size="xs" rot={0} slam={slamId === id} /> : <Back size="xs" />}
            {offered && (
              <div style={{ position: "absolute", top: -16, left: 0, right: 0, textAlign: "center" }}><Ico n="up" s={14} c="#B8862B" sw={2} /></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Peppa({ room, gs, seat, mine, slamId, commit }) {
  const opp = other(seat);
  const done = gs.done;
  const holder = other(gs.turn); // the player being drawn from this round
  const iAmDrawer = gs.turn === seat && !done;
  const iAmHolder = holder === seat && !done;
  const arranging = gs.phase === "arrange";
  const drawing = gs.phase === "draw";
  const canDraw = iAmDrawer && drawing;
  const canArrange = iAmHolder && arranging;

  const last = gs.last;
  const lastCard = last && last.card ? last.card : null;
  const status = done
    ? gs.win
      ? gs.win === seat
        ? "L’altro resta con la Peppa — hai vinto!"
        : "Resti tu con la Peppa…"
      : "Pareggio"
    : arranging
    ? iAmHolder
      ? "Trascina per sistemare, su per offrire — poi presenta"
      : `${who(room, holder)} sta sistemando la sua mano`
    : iAmDrawer
    ? "Pesca una carta coperta"
    : `${who(room, gs.turn)} sta pescando dalla tua mano`;

  const topMode = canDraw ? "draw" : "watch";
  const topOffer = opp === holder ? gs.offer : null; // the offer lives on the holder's hand
  const botMode = canArrange ? "arrange" : "watch";
  const botOffer = seat === holder ? gs.offer : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {/* opponent's hand (face-down): you draw from it on your beat, and watch it
          move as they arrange */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>{who(room, opp)}</div>
        <Micro>{gs.hands[opp].length} in mano · {gs.shed[opp]} scartate</Micro>
      </div>
      <PeppaHand
        cards={gs.hands[opp]}
        faceUp={false}
        mode={topMode}
        offerId={topOffer}
        onDraw={(idx) => canDraw && commit(peppaDraw(gs, seat, idx))}
        slamId={slamId}
      />

      {/* the middle — the last card drawn is revealed here */}
      <div style={{ flex: 1, margin: "10px 0", minHeight: 108, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        {lastCard ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Card card={lastCard} size="lg" rot={0} slam={slamId === lastCard.id} enter />
            <Micro>{last.paired ? "coppia scartata" : `${who(room, last.seat)} la tiene`}</Micro>
          </div>
        ) : (
          <Micro>nessuna pescata</Micro>
        )}
        <div key={`${done}-${gs.turn}-${gs.phase}`} className="swap" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", textAlign: "center", padding: "0 8px" }}>
          {status}
        </div>
      </div>

      {/* your hand (face up): drag to arrange, flick a card up to offer it */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>
          {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
        </div>
        <Micro>{gs.hands[seat].length} in mano · {gs.shed[seat]} scartate</Micro>
      </div>
      <div style={{ borderRadius: 12, border: canArrange ? `1px dashed ${T.ink30}` : "1px solid transparent", background: canArrange ? "rgba(18,18,18,0.02)" : "transparent", transition: "background 160ms ease" }}>
        <PeppaHand
          cards={gs.hands[seat]}
          faceUp={true}
          mode={botMode}
          offerId={botOffer}
          onReorder={(id, idx) => canArrange && commit(peppaReorder(gs, seat, id, idx))}
          onOffer={(id) => canArrange && commit(peppaOffer(gs, seat, id))}
          slamId={slamId}
        />
      </div>

      {canArrange && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Button kind="outline" full onClick={() => commit(peppaShuffle(gs, seat))}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="shuffle" s={16} /> Mischia</span>
          </Button>
          <Button kind="solid" full onClick={() => commit(peppaReady(gs, seat))}>
            Presento →
          </Button>
        </div>
      )}

      <Micro style={{ textAlign: "center", marginTop: 12 }}>
        mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
      </Micro>
    </div>
  );
}

/* ── condottieri (tactics) ── */
const TSIDE = { A: "#2C557E", B: "#A5342F" }; // blue vs red
const rgbaOf = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const uIco = (type, s = 14, c) => <Ico n={type === "fante" ? "sword" : "bow"} s={s} c={c} />;
const THEXR = 23; // hex size (centre → corner) — small enough to pan a big map
const tpx = (q, r) => ({ x: THEXR * Math.sqrt(3) * (q + r / 2), y: THEXR * 1.5 * r });
const tCorners = (cx, cy) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + THEXR * Math.cos(a)).toFixed(1)},${(cy + THEXR * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

// Full-screen dice-roll reveal: the die tumbles through faces, lands on the
// damage, and a crit explodes. Fires on both devices from the shared anim id.
function RollReveal({ shot, onDone }) {
  const [n, setN] = useState(1);
  const [phase, setPhase] = useState("roll");
  useEffect(() => {
    if (!shot) return;
    setPhase("roll");
    const face = Math.max(2, shot.faceMax || 8);
    const iv = setInterval(() => setN(1 + Math.floor(Math.random() * face)), 55);
    const t1 = setTimeout(() => {
      clearInterval(iv);
      setN(shot.dmg);
      setPhase("show");
    }, 560);
    const t2 = setTimeout(() => onDone && onDone(), shot.crit ? 2000 : 1300);
    return () => {
      clearInterval(iv);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [shot && shot.id]);
  if (!shot) return null;
  const col = TSIDE[shot.side] || T.ink;
  const rolling = phase === "roll";
  return (
    <div
      onClick={onDone}
      style={{ position: "fixed", inset: 0, zIndex: 84, background: SCRIM, display: "grid", placeItems: "center", padding: 24 }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
          {uIco(shot.atkType, 13, "rgba(255,255,255,0.75)")} attacca {uIco(shot.tgtType, 13, "rgba(255,255,255,0.75)")}
        </div>
        <div
          key={`${shot.id}-${phase}`}
          className={rolling ? "tumble" : shot.crit ? "critshake" : "settle"}
          style={{
            width: 132,
            height: 132,
            borderRadius: 22,
            background: "#fff",
            border: `3px solid ${col}`,
            boxShadow: `0 18px 48px rgba(0,0,0,0.5)`,
            display: "grid",
            placeItems: "center",
            fontFamily: BRAND,
            fontWeight: 700,
            fontSize: 72,
            color: col,
          }}
        >
          {rolling ? n : shot.dmg}
        </div>
        {!rolling && (
          <div className="settle" style={{ textAlign: "center" }}>
            {shot.crit && (
              <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: "#E9B54B", letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                CRITICO! <Ico n="burst" s={20} c="#E9B54B" sw={2} />
              </div>
            )}
            <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 17, color: "#fff", marginTop: 2 }}>
              {shot.dmg} danni{shot.killed ? " — abbattuto!" : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Animated 3/4-slide "how to play", little text.
const TACT_SLIDES = [
  { icon: "dice", title: "Ogni pedina è un dado", body: "La faccia mostra la vita. Fante d8, Arciere d6." },
  { icon: "sword", title: "Ferito colpisce meno", body: "Attacchi tirando da 1 alla tua vita: più sei ferito, meno fai male." },
  { icon: "bow", title: "Muovi, poi tira", body: "A turno attivi una pedina: la sposti e attacchi. Puoi muovere la stessa pedina due volte per round." },
  { icon: "castle", title: "Come si vince", body: "Stermina l’altro, oppure tieni il suo castello per un turno intero sotto il fuoco. Ogni castello colpisce chi gli si ferma accanto." },
];
function TacticsHowTo({ onClose }) {
  const [i, setI] = useState(0);
  const s = TACT_SLIDES[i];
  const last = i === TACT_SLIDES.length - 1;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 86, background: SCRIM, display: "grid", placeItems: "center", padding: 22 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 20, padding: "26px 22px 18px", maxWidth: 340, width: "100%", boxShadow: "0 24px 60px rgba(18,18,18,0.4)", textAlign: "center" }}>
        <div key={i} className="pop" style={{ lineHeight: 1 }}>
          <Ico n={s.icon} s={52} c={T.ink} sw={1.5} />
        </div>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: T.ink, marginTop: 12 }}>{s.title}</div>
        <p style={{ color: T.ink60, fontSize: 14.5, lineHeight: 1.5, margin: "8px 0 0" }}>{s.body}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "18px 0 16px" }}>
          {TACT_SLIDES.map((_, k) => (
            <span key={k} style={{ width: 7, height: 7, borderRadius: 999, background: k === i ? T.ink : T.line }} />
          ))}
        </div>
        <Button kind="solid" full onClick={() => (last ? onClose() : setI(i + 1))}>
          {last ? "Giochiamo!" : "Avanti →"}
        </Button>
      </div>
    </div>
  );
}

function Tactics({ room, gs, seat, commit }) {
  const board = gs.board;
  const myTurn = gs.turn === seat && !gs.done;
  const [sel, setSel] = useState(null); // selected own unit id (battle)
  const [dest, setDest] = useState(null); // staged move hex key
  const [inspect, setInspect] = useState(null); // enemy unit id being previewed (move + range)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [help, setHelp] = useState(false);
  const [shot, setShot] = useState(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const seenAnim = useRef(null);
  const stageRef = useRef(null);
  const centeredRef = useRef("");

  // fire the roll reveal from the shared animation id
  useEffect(() => {
    const a = room?.anim;
    if (!a || a.id === seenAnim.current) return;
    seenAnim.current = a.id;
    if (room.ev && room.ev.t === "attack" && gs.last && gs.last.dmg != null) {
      setShot({ id: a.id, dmg: gs.last.dmg, crit: !!gs.last.crit, killed: !!gs.last.killed, atkType: gs.last.atkType, tgtType: gs.last.tgtType, side: room.ev.seat, faceMax: TACT.units[gs.last.atkType]?.max || 8 });
    }
  }, [room?.anim?.id]);

  // clear any stale selection when the turn/phase flips
  useEffect(() => {
    setSel(null);
    setDest(null);
    setInspect(null);
  }, [gs.turn, gs.phase]);

  // layout — bounds computed from the irregular cell set
  const centers = board.cells.map((c) => ({ c, ...tpx(c.q, c.r) }));
  const xs = centers.map((p) => p.x),
    ys = centers.map((p) => p.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys);
  const PAD = THEXR + 6;
  const BW = Math.max(...xs) - minX + 2 * PAD,
    BH = Math.max(...ys) - minY + 2 * PAD;
  const at = (q, r) => {
    const p = tpx(q, r);
    return { x: p.x - minX + PAD, y: p.y - minY + PAD };
  };

  // Centre the view on your own castle when a new board is dealt or you flip
  // seats — you start looking at your base, then pan across the big map.
  const sig = `${board.castle.A}|${board.castle.B}|${board.cells.length}|${seat}`;
  useEffect(() => {
    const el = stageRef.current;
    if (!el || centeredRef.current === sig) return;
    centeredRef.current = sig;
    const cc = unhkey(board.castle[seat]);
    const c = at(cc.q, cc.r);
    setZoom(1);
    setPan({ x: el.clientWidth / 2 - c.x, y: el.clientHeight / 2 - c.y });
  }, [sig]);

  // interaction sets
  const unit = sel ? gs.units[sel] : null;
  const active = unit && myTurn && gs.phase === "battle";
  const reach = active ? tacticsReach(gs, unit) : {};
  const stagePos = unit ? (dest ? unhkey(dest) : { q: unit.q, r: unit.r }) : null;
  const stageKey = unit ? hkey(stagePos.q, stagePos.r) : null;
  // resting on your own fountain/castle heals but forbids attacking this turn
  const healing = active && tacticsHeals(gs, seat, stageKey);
  const staged = { ...unit, ...stagePos };
  const targetIds = active && !healing ? tacticsTargets({ ...gs, units: { ...gs.units, [sel]: staged } }, staged) : [];
  const targetSet = new Set(targetIds.map((id) => hkey(gs.units[id].q, gs.units[id].r)));
  // the whole area this unit threatens from where it will stand — open hexes in
  // attack range with line of sight, so you can see its reach before committing
  const threatSet = new Set();
  if (active && !healing) {
    const u = TACT.units[unit.type];
    for (const c of board.cells) {
      const k = hkey(c.q, c.r);
      if (board.blocked[k] || k === stageKey) continue;
      const d = hdist(staged, c);
      if (d < u.min || d > u.rng) continue;
      if (u.rng > 1 && !tacticsLoS(gs, staged, c)) continue;
      threatSet.add(k);
    }
  }
  // previewing an enemy: show where it could step (its Move) and everything it
  // threatens from where it stands (attack range + line of sight), in its colour
  const insUnit = inspect && gs.units[inspect] && gs.phase === "battle" ? gs.units[inspect] : null;
  const insReach = insUnit ? tacticsReach(gs, insUnit) : {};
  const insThreatSet = new Set();
  if (insUnit) {
    const u = TACT.units[insUnit.type];
    const insKey = hkey(insUnit.q, insUnit.r);
    for (const c of board.cells) {
      const k = hkey(c.q, c.r);
      if (board.blocked[k] || k === insKey) continue;
      const d = hdist(insUnit, c);
      if (d < u.min || d > u.rng) continue;
      if (u.rng > 1 && !tacticsLoS(gs, insUnit, c)) continue;
      insThreatSet.add(k);
    }
  }
  const insCol = insUnit ? TSIDE[insUnit.owner] : null;

  const deploySet = myTurn && gs.phase === "deploy" ? new Set(board.cells.map((c) => hkey(c.q, c.r)).filter((k) => tacticsDeployable(gs, seat, k))) : new Set();
  const nextType = gs.phase === "deploy" ? gs.toPlace[seat][0] : null;

  const tapHex = (k) => {
    if (moved.current) return;
    if (!myTurn) return;
    if (gs.phase === "deploy") {
      if (deploySet.has(k)) commit(tacticsDeploy(gs, seat, nextType, k));
      return;
    }
    if (gs.phase === "battle" && unit) {
      const uk = hkey(unit.q, unit.r);
      if (k === uk) setDest(null);
      else if (reach[k] !== undefined) setDest(k);
    }
  };
  const tapUnit = (id) => {
    if (moved.current) return;
    if (gs.phase !== "battle") return;
    const u = gs.units[id];
    if (u.owner === seat) {
      if (myTurn && (gs.spent[id] || 0) < TACT.ACTS) {
        setSel(id);
        setDest(null);
        setInspect(null);
      }
      return;
    }
    // enemy unit: attack it if it's a valid target, otherwise preview its reach
    if (myTurn && sel && targetIds.includes(id)) {
      commit(tacticsActivate(gs, seat, sel, dest, { kind: "attack", targetId: id }));
      setSel(null);
      setDest(null);
      setInspect(null);
      return;
    }
    setInspect((cur) => (cur === id ? null : id));
  };
  const endUnit = () => {
    if (!sel) return;
    commit(tacticsActivate(gs, seat, sel, dest, null));
    setSel(null);
    setDest(null);
    setInspect(null);
  };

  // pan (screen-space), tap vs drag disambiguation
  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, px: pan.x, py: pan.y };
    moved.current = false;
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - drag.current.x,
      dy = p.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 7) moved.current = true;
    if (moved.current) setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
  };
  const onUp = () => {
    drag.current = null;
    setTimeout(() => (moved.current = false), 0);
  };
  // zoom about the centre of the screen so the view doesn't lurch
  const zoomBy = (f) => {
    const el = stageRef.current;
    const nz = Math.max(0.55, Math.min(1.7, zoom * f));
    if (!el) return setZoom(nz);
    const cx = el.clientWidth / 2,
      cy = el.clientHeight / 2;
    const bx = (cx - pan.x) / zoom,
      by = (cy - pan.y) / zoom;
    setPan({ x: cx - nz * bx, y: cy - nz * by });
    setZoom(nz);
  };
  const resetView = () => {
    const el = stageRef.current;
    setZoom(1);
    if (!el) return setPan({ x: 0, y: 0 });
    const cc = unhkey(board.castle[seat]);
    const c = at(cc.q, cc.r);
    setPan({ x: el.clientWidth / 2 - c.x, y: el.clientHeight / 2 - c.y });
  };

  const baseStatus = gs.done
    ? gs.win
      ? gs.win === seat
        ? gs.how === "castle"
          ? "Hai preso il castello — vittoria!"
          : "Nemico sterminato — vittoria!"
        : "Sconfitta…"
      : "Pareggio"
    : gs.phase === "roster"
    ? gs.roster[seat] == null
      ? "Scegli la tua compagnia"
      : `${who(room, other(seat))} sta scegliendo…`
    : gs.phase === "deploy"
    ? myTurn
      ? `Schiera vicino al castello — ${TACT.units[nextType]?.name} (${gs.toPlace[seat].length} rimasti)`
      : `${who(room, gs.turn)} sta schierando…`
    : myTurn
    ? sel
      ? healing
        ? "In cura qui — niente attacco questo turno"
        : dest
        ? "Tocca un nemico in rosso, o Fermati qui"
        : "Muovi, o colpisci un nemico in rosso"
      : "Tocca una tua pedina"
    : `Turno di ${who(room, gs.turn)}`;
  const insU = insUnit ? TACT.units[insUnit.type] : null;
  const status =
    insUnit && !sel
      ? `${insU.name} nemico — muove fino a ${insU.move}, colpisce a ${insU.min === insU.rng ? insU.rng : `${insU.min}–${insU.rng}`}`
      : baseStatus;

  const vbtn = {
    ...plain,
    width: 34,
    height: 34,
    borderRadius: 9,
    border: `1px solid ${T.line}`,
    background: "rgba(18,18,18,0.03)",
    color: T.ink,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    WebkitTapHighlightColor: "transparent",
  };

  const specialMark = (k) => {
    if (k === board.castle.A) return { kind: "castle", side: "A" };
    if (k === board.castle.B) return { kind: "castle", side: "B" };
    if (k === board.fount.A) return { kind: "fount", side: "A" };
    if (k === board.fount.B) return { kind: "fount", side: "B" };
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {shot && <RollReveal shot={shot} onDone={() => setShot(null)} />}
      {help && <TacticsHowTo onClose={() => setHelp(false)} />}

      {/* top bar: turn/round + view controls + how-to */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: TSIDE[gs.turn], display: "inline-block", opacity: gs.done ? 0.3 : 1 }} />
          <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 13 }}>
            {gs.phase === "battle" ? `Round ${gs.round}` : gs.phase === "deploy" ? "Schieramento" : "Compagnia"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={vbtn} onClick={() => zoomBy(1.2)} title="zoom"><Ico n="plus" s={16} /></button>
          <button style={vbtn} onClick={() => zoomBy(1 / 1.2)} title="zoom"><Ico n="minus" s={16} /></button>
          <button style={vbtn} onClick={resetView} title="centra sul castello"><Ico n="recenter" s={16} /></button>
          <button style={vbtn} onClick={() => setHelp(true)} title="come si gioca"><Ico n="help" s={16} /></button>
        </div>
      </div>

      {/* the board — flat, full-bleed, no frame; pan by dragging, pinch-free zoom
          with the buttons. It breaks out of the centred column to fill the width. */}
      <div
        ref={stageRef}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        style={{
          flex: 1,
          minHeight: 320,
          width: "100vw",
          marginLeft: "calc(-50vw + 50%)",
          position: "relative",
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: BW, height: BH }}>
          <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            {centers.map(({ c }) => {
              const k = hkey(c.q, c.r);
              const p = at(c.q, c.r);
              const blocked = board.blocked[k];
              const sp = specialMark(k);
              const isReach = reach[k] !== undefined;
              const isTarget = targetSet.has(k);
              const isThreat = threatSet.has(k);
              const isDeploy = deploySet.has(k);
              const isSelHex = unit && k === hkey(unit.q, unit.r);
              const isDest = dest === k;
              const isInsReach = insReach[k] !== undefined;
              const isInsThreat = insThreatSet.has(k);
              const isInsHex = insUnit && k === hkey(insUnit.q, insUnit.r);
              let fill = blocked ? "rgba(18,18,18,0.28)" : "rgba(255,255,255,0.9)";
              if (sp && sp.kind === "fount") fill = "rgba(44,120,160,0.22)";
              if (isInsReach) fill = rgbaOf(insCol, 0.16); // where the selected enemy could step
              if (isInsThreat) fill = rgbaOf(insCol, 0.3); // what the selected enemy threatens
              if (isThreat) fill = "rgba(165,52,47,0.12)"; // attack area — a light red wash
              if (isReach || isDest) fill = "rgba(46,120,90,0.30)"; // where you can move
              if (isDeploy) fill = "rgba(184,134,43,0.24)";
              if (isTarget) fill = "rgba(165,52,47,0.34)"; // an enemy you can hit
              const stroke = isSelHex
                ? T.ink
                : isTarget
                ? "#A5342F"
                : isThreat
                ? "rgba(165,52,47,0.6)"
                : isInsHex
                ? insCol
                : isInsThreat
                ? rgbaOf(insCol, 0.6)
                : sp && sp.kind === "castle"
                ? TSIDE[sp.side]
                : T.line;
              return (
                <g key={k}>
                  <polygon
                    points={tCorners(p.x, p.y)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelHex || isTarget || isInsHex || (sp && sp.kind === "castle") ? 2.2 : isThreat || isInsThreat ? 1.5 : 1}
                    className={isTarget || isDeploy ? "hexpulse" : ""}
                    onClick={() => tapHex(k)}
                    style={{ cursor: myTurn && (isReach || isDeploy || isTarget || isDest || isSelHex) ? "pointer" : "default" }}
                  />
                  {sp && (
                    <g transform={`translate(${p.x - 7} ${p.y - 7})`} style={{ pointerEvents: "none" }}>
                      <Ico n={sp.kind === "castle" ? "castle" : "drop"} s={14} c={sp.kind === "castle" ? TSIDE[sp.side] : "#2C7AA0"} sw={1.9} />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* unit dice, flat on the board */}
          {gs.order.map((id) => {
            const u = gs.units[id];
            const showAt = sel === id && dest ? unhkey(dest) : { q: u.q, r: u.r };
            const p = at(showAt.q, showAt.r);
            const spent = (gs.spent[id] || 0) >= TACT.ACTS && gs.phase === "battle";
            const isSel = sel === id;
            const isIns = inspect === id;
            const isTgt = targetSet.has(hkey(u.q, u.r)) && !(sel === id);
            const col = TSIDE[u.owner];
            return (
              <div
                key={id}
                onClick={() => tapUnit(id)}
                style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", cursor: myTurn ? "pointer" : "default", transition: "left 200ms ease, top 200ms ease" }}
              >
                <div
                  className={isSel ? "floaty" : ""}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "#fff",
                    border: `2.5px solid ${col}`,
                    outline: isSel ? `2px solid ${T.ink}` : isTgt ? `2px solid #A5342F` : isIns ? `2px solid ${col}` : "none",
                    outlineOffset: 1,
                    boxShadow: `0 2px 5px rgba(18,18,18,0.28)`,
                    display: "grid",
                    placeItems: "center",
                    position: "relative",
                    opacity: spent ? 0.5 : 1,
                  }}
                >
                  <span style={{ position: "absolute", top: 0, left: 2 }}>{uIco(u.type, 9, col)}</span>
                  <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18, color: col, lineHeight: 1 }}>{u.hp}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* status + actions */}
      <div style={{ marginTop: 10, textAlign: "center", minHeight: 22 }}>
        <div key={status} className="swap" style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 15 }}>{status}</div>
      </div>

      {gs.phase === "roster" && myTurn && gs.roster[seat] == null && (
        <div style={{ marginTop: 12 }}>
          <Micro style={{ textAlign: "center" }}>Compagnia di 4 · almeno un Fante e un Arciere</Micro>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {[1, 2, 3].map((f) => (
              <button
                key={f}
                onClick={() => commit(tacticsRoster(gs, seat, f))}
                style={{ ...plain, flex: 1, border: `1.5px solid ${T.ink}`, borderRadius: 12, padding: "10px 6px", cursor: "pointer", fontFamily: BRAND, fontWeight: 600, fontSize: 13, WebkitTapHighlightColor: "transparent" }}
              >
                {f} {uIco("fante", 14)} · {4 - f} {uIco("arciere", 14)}
              </button>
            ))}
          </div>
        </div>
      )}

      {gs.phase === "battle" && myTurn && sel && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {dest ? (
            <Button kind="outline" full onClick={() => setDest(null)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="rotateL" s={15} /> Annulla mossa</span>
            </Button>
          ) : (
            <Button kind="outline" full onClick={() => { setSel(null); setDest(null); }}>
              Deseleziona
            </Button>
          )}
          <Button kind="solid" full onClick={endUnit}>
            {healing ? "Curati qui" : dest ? "Fermati qui" : "Passa"}
          </Button>
        </div>
      )}

      <Micro style={{ textAlign: "center", marginTop: 12 }}>
        {who(room, "A")} {gs.order.filter((id) => gs.units[id].owner === "A").length} · {who(room, "B")} {gs.order.filter((id) => gs.units[id].owner === "B").length} pedine · mani {gs.tally.A}–{gs.tally.B}
      </Micro>
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
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {/* opponent packet */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>{who(room, opp)}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <Micro>{gs.decks[opp].length}</Micro>
          <DeckBox n={gs.decks[opp].length} size="sm" live={!mine && !gs.done} />
        </div>
      </div>

      {/* the middle — grows to fill the height between the two packets */}
      <div style={{ flex: 1, margin: "16px 0", minHeight: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
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
          borderRadius: 12,
          border: `1px dashed ${mine ? T.ink30 : T.line}`,
          background: mine ? "rgba(18,18,18,0.02)" : "transparent",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 14,
          padding: "16px 0 20px",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: mine && !gs.done ? "grab" : "default",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* the hint lives in normal flow — it can never sit under the deck */}
        <Micro>{gs.done ? "mano finita" : mine ? "trascina il mazzo in su per giocare" : "tocca all’altro"}</Micro>
        <div style={{ opacity: gs.decks[seat].length ? 1 : 0.4 }}>
          <DeckBox n={gs.decks[seat].length} size="xl" live={mine && !gs.done} lift={mine ? -dragY / 70 : 0} />
        </div>
        <div style={{ fontFamily: BRAND, fontSize: 20, fontWeight: 700, letterSpacing: "0.16em", color: mine && !gs.done ? T.ink : T.ink30 }}>{label}</div>
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
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {nameRow(opp, false)}
        <div style={{ display: "flex", gap: 3 }}>
          {gs.hands[opp].map((c) => (
            <Back key={c.id} size="xs" />
          ))}
        </div>
      </div>

      {/* trump + stock, and the trick in play — grows to fill the middle */}
      <div style={{ position: "relative", flex: 1, minHeight: 168, margin: "16px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
  const [bidQty, setBidQty] = useState(1);
  const [bidFace, setBidFace] = useState(2);
  const rolled = gs.rolled[seat];
  const canRoll = gs.phase === "roll" && mine && !rolled;
  const tapRoll = () => {
    if (gs.phase === "roll" && gs.turn === seat && !gs.rolled[seat]) commit(perudoRoll(gs, seat));
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
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {/* opponent packet */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, opp)}</div>
        <div style={{ display: "flex", gap: 4 }}>
          {Array.from({ length: gs.counts[opp] }).map((_, i) => (
            <Die key={i} hidden size={26} />
          ))}
        </div>
      </div>

      {/* the standing bid / reveal / prompt — grows to fill the middle */}
      <div style={{ flex: 1, minHeight: 150, margin: "16px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
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
              Lancia i dadi
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
  const [showOpp, setShowOpp] = useState(false); // peek at the opponent's card
  const [showHelp, setShowHelp] = useState(false); // how scoring works
  const myScore = gs.scores[seat];
  const oppScore = gs.scores[opp];
  const myTotal = yahtTotal(myScore);
  const oppTotal = yahtTotal(oppScore);
  const canRoll = mine && gs.rollsLeft > 0 && !gs.done;
  const canScore = mine && gs.rolled && !gs.done;
  const tapRoll = () => {
    if (mine && gs.rollsLeft > 0 && !gs.done) commit(yahtRoll(gs, seat));
  };
  // Five of a kind → a big "Yahtzee!" flash for both players, once per roll.
  const [yflash, setYflash] = useState(0);
  const yseen = useRef(null);
  const diceKey = gs.dice.join(",");
  const isYahtzee = gs.rolled && gs.dice.length === 5 && gs.dice.every((d) => d && d === gs.dice[0]);
  useEffect(() => {
    if (isYahtzee && yseen.current !== diceKey) {
      yseen.current = diceKey;
      setYflash((n) => n + 1);
      const t = setTimeout(() => setYflash(0), 1700);
      return () => clearTimeout(t);
    }
    if (!isYahtzee) yseen.current = null;
  }, [diceKey, gs.rolled]);

  return (
    <div style={{ paddingBottom: 56 }}>
      {/* peek the opponent's scorecard — a toggle pinned bottom-right, out of
          the way of the dice and your own card */}
      <button
        onClick={() => setShowOpp((v) => !v)}
        aria-label={`Scheda di ${who(room, opp)}`}
        style={{
          position: "fixed",
          right: "calc(14px + env(safe-area-inset-right))",
          bottom: "calc(14px + env(safe-area-inset-bottom))",
          zIndex: 60,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          background: showOpp ? T.ink : T.paper,
          color: showOpp ? T.bg : T.ink,
          border: `1px solid ${showOpp ? T.ink : T.line}`,
          borderRadius: 999,
          padding: "9px 14px",
          boxShadow: "0 6px 18px rgba(18,18,18,0.18)",
          fontFamily: BRAND,
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          transition: "background 160ms ease, color 160ms ease",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Ico n="clip" s={16} /> {who(room, opp)}
      </button>

      {yflash > 0 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 55, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div key={yflash} className="scopaflash" style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(56px, 19vw, 132px)", color: "#B8862B", letterSpacing: "-0.03em", textShadow: "0 6px 0 rgba(18,18,18,0.1)", whiteSpace: "nowrap" }}>
            Yahtzee!
          </div>
        </div>
      )}
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, opp)}</div>
        <Micro>
          {oppTotal.total} punti · {Object.keys(oppScore).length}/13
        </Micro>
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button onClick={() => setShowHelp(true)} style={{ ...plain, color: T.ink, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Ico n="help" s={15} /> come si conta
        </button>
      </div>

      {showOpp && (
        <Sheet title={`Scheda di ${who(room, opp)}`} onClose={() => setShowOpp(false)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
            {YCATS.map((cat) => (
              <div key={cat.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${T.line}` }}>
                <span style={{ color: T.ink60 }}>{cat.label}</span>
                <span style={{ fontWeight: 600, color: cat.k in oppScore ? T.ink : T.ink30 }}>{cat.k in oppScore ? oppScore[cat.k] : "–"}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: BRAND, fontWeight: 600, fontSize: 15 }}>
            <span style={{ color: T.ink60 }}>Bonus {oppTotal.upper}/63{oppTotal.bonus ? " +35" : ""}</span>
            <span>Totale {oppTotal.total}</span>
          </div>
        </Sheet>
      )}
      {showHelp && (
        <Sheet title="Come si contano i punti" onClose={() => setShowHelp(false)}>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: T.ink80 || T.ink }}>
            {[
              ["Uno–Sei", "somma dei dadi di quel numero"],
              ["Bonus", "+35 se in alto (Uno–Sei) arrivi a 63"],
              ["Tris", "con almeno 3 dadi uguali, vale la somma di tutti e cinque i dadi (non solo dei tre uguali)"],
              ["Poker", "con almeno 4 dadi uguali, vale la somma di tutti e cinque i dadi (non solo dei quattro uguali)"],
              ["Full", "25 — tre uguali più due uguali"],
              ["Scala", "30 — quattro in fila"],
              ["Scalona", "40 — cinque in fila"],
              ["Cinquina", "50 — cinque uguali"],
              ["Chance", "somma di tutti i dadi, sempre"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 10, padding: "4px 0" }}>
                <span style={{ fontWeight: 700, minWidth: 78, color: T.ink }}>{k}</span>
                <span style={{ color: T.ink60 }}>{v}</span>
              </div>
            ))}
          </div>
        </Sheet>
      )}

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
                {gs.rolled ? `Ritira · ${gs.rollsLeft} rimasti` : "Lancia i dadi"}
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

/* ── scala 40 ── */
const S40_SUIT = { H: { g: "♥", c: "#B23A2E" }, D: { g: "♦", c: "#B23A2E" }, C: { g: "♣", c: "#1A1A1A" }, S: { g: "♠", c: "#1A1A1A" } };
const s40lbl = (v) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[v] || String(v));
// Two readable restings orders, jokers last either way. "seme" groups by suit
// (colours alternating) then rank; "numero" groups by rank then suit. Used for
// the sort buttons and the default layout; a drawn card slots in by suit.
const S40_SUIT_ORD = { H: 0, S: 1, D: 2, C: 3 };
const s40KeySuit = (c) => (c.joker ? [9, 99] : [S40_SUIT_ORD[c.s], c.v]);
const s40KeyNum = (c) => (c.joker ? [99, 9] : [c.v, S40_SUIT_ORD[c.s]]);
const s40Before = (a, b) => {
  const ka = s40KeySuit(a),
    kb = s40KeySuit(b);
  return ka[0] !== kb[0] ? ka[0] < kb[0] : ka[1] < kb[1];
};
const s40Sorted = (cards, by = "seme") => {
  const key = by === "numero" ? s40KeyNum : s40KeySuit;
  return cards
    .slice()
    .sort((a, b) => {
      const ka = key(a),
        kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    })
    .map((c) => c.id);
};
function S40Card({ card, w = 32, h = 46, sel, dim, fresh, onClick }) {
  const style = {
    width: w,
    height: h,
    borderRadius: 5,
    background: "#fff",
    border: `1px solid ${sel ? "#B8862B" : fresh ? "#2C557E" : T.line}`,
    boxShadow: sel ? "0 6px 13px rgba(18,18,18,0.22)" : fresh ? "0 0 0 2px #2C557E, 0 4px 11px rgba(44,85,126,0.42)" : "0 1px 3px rgba(18,18,18,0.14)",
    position: "relative",
    flexShrink: 0,
    padding: 0,
    cursor: onClick ? "pointer" : "default",
    transform: sel ? "translateY(-9px)" : "none",
    transition: "transform 130ms ease, box-shadow 130ms ease, border-color 130ms ease",
    opacity: dim ? 0.4 : 1,
    WebkitTapHighlightColor: "transparent",
    // A non-interactive card must let taps fall through to a parent handler
    // (the discard pile draws, a table meld receives a lay-off) — a disabled
    // <button> would otherwise swallow the click.
    pointerEvents: onClick ? "auto" : "none",
  };
  const cls = fresh && !sel ? "freshcard" : "";
  if (card.joker && !card.rep)
    return (
      <button className={cls} onClick={onClick} disabled={!onClick} style={style}>
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#B8862B", fontWeight: 800, fontSize: h * 0.4, fontFamily: BRAND }}>
          ★
        </span>
      </button>
    );
  // A pinned joker wears the face of the card it stands for, with a ★ corner.
  const rep = card.joker ? card.rep : card;
  const su = S40_SUIT[rep.s];
  if (card.joker)
    return (
      <button className={cls} onClick={onClick} disabled={!onClick} style={{ ...style, border: `1px solid ${fresh && !sel ? "#2C557E" : "#B8862B"}` }}>
        <span style={{ position: "absolute", top: 2, left: 4, fontSize: h * 0.27, fontWeight: 800, color: su.c, lineHeight: 1, fontFamily: BRAND }}>{s40lbl(rep.v)}</span>
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: h * 0.4, color: su.c }}>{su.g}</span>
        <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: h * 0.22, color: "#B8862B", fontWeight: 800 }}>★</span>
      </button>
    );
  return (
    <button className={cls} onClick={onClick} disabled={!onClick} style={style}>
      <span style={{ position: "absolute", top: 2, left: 4, fontSize: h * 0.27, fontWeight: 800, color: su.c, lineHeight: 1, fontFamily: BRAND }}>
        {s40lbl(card.v)}
      </span>
      <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: h * 0.4, color: su.c }}>{su.g}</span>
    </button>
  );
}

function Scala({ room, gs, seat, mine, commit }) {
  const opp = other(seat);
  const [sel, setSel] = useState([]);
  const [staged, setStaged] = useState([]);
  const [hint, setHint] = useState("");
  const [jokerAsk, setJokerAsk] = useState(null); // { options:[{rank,suit}], done:(rep)=>void }
  const [drewId, setDrewId] = useState(null); // the card just pescata — highlighted until the turn ends
  useEffect(() => {
    setSel([]);
    setStaged([]);
    setHint("");
    setJokerAsk(null);
    setDrewId(null);
  }, [gs.turn, gs.phase, gs.done]);
  const selKey = sel.join(",");
  useEffect(() => {
    setHint("");
    setJokerAsk(null);
  }, [selKey, staged.length]);
  const hand = gs.hands[seat];
  const stagedIds = new Set(staged.flatMap((m) => m.ids));
  const selCards = sel.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  const selMeld = selCards.length >= 3 ? analyzeMeld(selCards) : { ok: false };
  const opened = gs.opened[seat];
  const stagedTotal = staged.reduce((s, m) => s + m.value, 0);

  const toggle = (id) => {
    if (stagedIds.has(id)) return;
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const canTakeDiscard = mine && gs.phase === "draw" && gs.discard.length > 0 && s40CanUseDiscard(gs, seat);
  const draw = (source) => {
    if (!(mine && gs.phase === "draw")) return;
    if (source === "discard" && !canTakeDiscard) return setHint("Prendi lo scarto solo se lo usi subito — in un tris, una scala o l’apertura.");
    commit(s40Draw(gs, seat, source));
  };
  const layOff = (meldId) => {
    if (!(opened && sel.length === 1 && gs.phase === "meld")) return;
    const meld = gs.melds.find((m) => m.id === meldId);
    const card = hand.find((c) => c.id === sel[0]);
    if (card && card.joker && meld) {
      const opts = s40JokerRuns([...meld.cards, card]);
      if (opts.length >= 2) return setJokerAsk({ options: opts, done: (rep) => commit(s40LayOff(gs, seat, sel[0], meldId, rep)) });
      return commit(s40LayOff(gs, seat, sel[0], meldId, opts.length === 1 ? { s: opts[0].suit, v: opts[0].rank } : undefined));
    }
    commit(s40LayOff(gs, seat, sel[0], meldId));
  };

  // ── local hand order ──────────────────────────────────────────────
  // How the cards are arranged is a per-device preference: it never leaves
  // this client, never bumps v. `order` holds the ids; it reconciles with the
  // real hand as cards are drawn, melded or discarded (new cards go to the end,
  // gone cards drop out). Reordering is a pointer-drag; a tap still selects.
  const [order, setOrder] = useState([]);
  const [dragId, setDragId] = useState(null);
  const drag = useRef(null);
  const handRow = useRef(null);
  const handKey = hand.map((c) => c.id).join(",");
  const cardOf = (id) => hand.find((c) => c.id === id);
  useEffect(() => {
    const ids = hand.map((c) => c.id);
    setOrder((prev) => {
      const keep = prev.filter((id) => ids.includes(id));
      const add = ids.filter((id) => !keep.includes(id));
      if (keep.length === prev.length && add.length === 0) return prev;
      if (keep.length === 0) return s40Sorted(hand); // first layout: fully sorted
      // a drawn card slots into its sorted place without disturbing the rest
      const next = keep.slice();
      for (const id of add) {
        const c = cardOf(id);
        let i = 0;
        while (i < next.length && !s40Before(c, cardOf(next[i]))) i++;
        next.splice(i, 0, id);
      }
      return next;
    });
  }, [handKey]);
  const laid = order.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  const ordered = laid.length === hand.length ? laid : hand;

  // The pescata: when exactly one card appears in hand, flag it as just-drawn.
  const prevIds = useRef(null);
  useEffect(() => {
    const ids = hand.map((c) => c.id);
    if (prevIds.current) {
      const added = ids.filter((id) => !prevIds.current.includes(id));
      if (added.length === 1) setDrewId(added[0]);
    }
    prevIds.current = ids;
  }, [handKey]);

  const cardDown = (e, id) => {
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const cardMove = (e) => {
    const s = drag.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < 7) return;
    if (!s.moved) {
      s.moved = true;
      setDragId(s.id);
    }
    e.preventDefault();
    const row = handRow.current;
    if (!row) return;
    let best = null,
      bestD = Infinity,
      after = false;
    for (const el of row.children) {
      const cid = el.dataset.cid;
      if (!cid || cid === s.id) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < bestD) {
        bestD = d;
        best = cid;
        after = e.clientX > cx;
      }
    }
    if (best == null) return;
    setOrder((prev) => {
      const arr = prev.filter((id) => id !== s.id);
      let idx = arr.indexOf(best);
      if (idx < 0) return prev;
      if (after) idx += 1;
      arr.splice(idx, 0, s.id);
      return arr.join(",") === prev.join(",") ? prev : arr;
    });
  };
  const cardUp = (e) => {
    const s = drag.current;
    drag.current = null;
    setDragId(null);
    if (!s) return;
    try {
      e.currentTarget.releasePointerCapture(s.pid);
    } catch {}
    if (!s.moved && mine && gs.phase === "meld") toggle(s.id);
  };

  // Actions never dead-end: the buttons stay live during your meld turn and,
  // when a move isn't legal yet, say what's missing instead of greying out.
  const notAMeld = () => setHint(sel.length < 3 ? "Seleziona almeno 3 carte per un tris o una scala." : "Quelle carte non formano un tris né una scala.");
  const jokerId = () => (selCards.find((c) => c.joker && !c.rep) || {}).id;
  const doCala = () => {
    if (!selMeld.ok) return notAMeld();
    const opts = s40JokerRuns(selCards);
    const jid = jokerId();
    if (opts.length >= 2) return setJokerAsk({ options: opts, done: (rep) => commit(s40Meld(gs, seat, sel, { [jid]: rep })) });
    commit(s40Meld(gs, seat, sel, opts.length === 1 ? { [jid]: { s: opts[0].suit, v: opts[0].rank } } : undefined));
  };
  const stageMeld = (reps) => {
    const cards = selCards.map((c) => (reps && reps[c.id] ? { ...c, rep: reps[c.id] } : c));
    setStaged((s) => [...s, { ids: sel, value: analyzeMeld(cards).value, reps }]);
    setSel([]);
  };
  const doAggiungi = () => {
    if (!selMeld.ok) return notAMeld();
    const opts = s40JokerRuns(selCards);
    const jid = jokerId();
    if (opts.length >= 2) return setJokerAsk({ options: opts, done: (rep) => stageMeld({ [jid]: rep }) });
    stageMeld(opts.length === 1 ? { [jid]: { s: opts[0].suit, v: opts[0].rank } } : undefined);
  };
  const doApri = () => (stagedTotal >= 40 ? commit(s40Open(gs, seat, staged)) : setHint(`Ti servono 40 punti per aprire — sei a ${stagedTotal}.`));
  const doScarta = () =>
    sel.length === 1 ? commit(s40Discard(gs, seat, sel[0])) : setHint(sel.length === 0 ? "Tocca una carta, poi Scarta per finire il turno." : "Per scartare seleziona una sola carta.");

  const target = opened && sel.length === 1 && gs.phase === "meld";
  const acting = mine && !gs.done;
  // room for the floating action bar so the last cards never hide behind it
  const padBottom = gs.done ? 8 : acting && gs.phase === "meld" ? 168 : 96;

  // Each player's melds sit on their own side of the deck — the opponent's above
  // it, yours below — and wrap down the page rather than scrolling sideways.
  const myMelds = gs.melds.filter((m) => m.owner === seat);
  const oppMelds = gs.melds.filter((m) => m.owner === opp);
  const meldGroup = (m) => (
    <div
      key={m.id}
      onClick={target ? () => layOff(m.id) : undefined}
      style={{ display: "flex", padding: 4, borderRadius: 8, border: `1px solid ${target ? T.ink : "transparent"}`, cursor: target ? "pointer" : "default" }}
    >
      {m.cards.map((c, i) => (
        <div key={c.id} style={{ marginLeft: i ? -14 : 0 }}>
          <S40Card card={c} w={30} h={44} />
        </div>
      ))}
    </div>
  );
  const meldArea = (melds, empty) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, rowGap: 10, padding: "6px 2px", minHeight: 54, alignItems: "center", justifyContent: melds.length ? "flex-start" : "center" }}>
      {melds.length ? melds.map(meldGroup) : <Micro style={{ padding: "12px 0" }}>{empty}</Micro>}
    </div>
  );

  return (
    <div style={{ paddingBottom: padBottom }}>
      {/* opponent — their melds sit on their side of the deck */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>
          {who(room, opp)} <span style={{ color: T.ink30, fontWeight: 400 }}>{gs.opened[opp] ? "aperto" : ""}</span>
        </div>
        <Micro>{gs.hands[opp].length} carte</Micro>
      </div>
      {meldArea(oppMelds, "niente ancora")}

      {/* stock + discard — the deck between the two sides */}
      <div style={{ display: "flex", justifyContent: "center", gap: 28, alignItems: "flex-end", margin: "6px 0" }}>
        <div style={{ textAlign: "center" }}>
          <div onClick={() => draw("stock")} style={{ cursor: mine && gs.phase === "draw" ? "pointer" : "default", display: "inline-block", outline: mine && gs.phase === "draw" ? `2px solid ${T.ink}` : "none", outlineOffset: 3, borderRadius: 7 }}>
            <Back size="md" stack />
          </div>
          <Micro style={{ marginTop: 6 }}>mazzo {gs.deck.length}</Micro>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            onClick={() => draw("discard")}
            style={{ cursor: canTakeDiscard ? "pointer" : "default", display: "inline-block", outline: canTakeDiscard ? `2px solid ${T.ink}` : "none", outlineOffset: 3, borderRadius: 7, opacity: mine && gs.phase === "draw" && !canTakeDiscard ? 0.5 : 1 }}
          >
            {gs.discard.length ? <S40Card card={gs.discard[gs.discard.length - 1]} w={54} h={76} /> : <Ghost size="md" />}
          </div>
          <Micro style={{ marginTop: 6 }}>scarti</Micro>
        </div>
      </div>

      {/* your melds — your side of the deck */}
      {(myMelds.length > 0 || opened) && (
        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 4 }}>
          <Micro>Le tue combinazioni{target ? " · tocca per attaccare" : ""}</Micro>
          {meldArea(myMelds, "niente ancora")}
        </div>
      )}

      {/* your hand */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>
          {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ ...plain, color: T.ink30 }}>ordina:</span>
          <button onClick={() => setOrder(s40Sorted(hand, "numero"))} style={{ ...plain, color: T.ink }}>
            numero
          </button>
          <button onClick={() => setOrder(s40Sorted(hand, "seme"))} style={{ ...plain, color: T.ink }}>
            seme
          </button>
          <Micro>{hand.length}</Micro>
        </div>
      </div>
      <div ref={handRow} style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", touchAction: "none" }}>
        {ordered.map((c) => (
          <div
            key={c.id}
            data-cid={c.id}
            onPointerDown={(e) => cardDown(e, c.id)}
            onPointerMove={cardMove}
            onPointerUp={cardUp}
            onPointerCancel={cardUp}
            style={{
              touchAction: "none",
              cursor: dragId === c.id ? "grabbing" : "grab",
              transition: dragId ? "none" : "transform 130ms ease",
              transform: dragId === c.id ? "scale(1.08)" : "none",
              zIndex: dragId === c.id ? 5 : 1,
              filter: dragId === c.id ? "drop-shadow(0 9px 15px rgba(18,18,18,0.3))" : "none",
            }}
          >
            <S40Card card={c} w={42} h={60} sel={sel.includes(c.id)} fresh={c.id === drewId} dim={stagedIds.has(c.id) && dragId !== c.id} onClick={() => {}} />
          </div>
        ))}
      </div>

      {/* pinned action strip */}
      {!gs.done && (
        <FloatBar>
          {!mine && <Micro style={{ textAlign: "center" }}>tocca a {who(room, opp)}</Micro>}
          {mine && gs.phase === "draw" && (
            <Micro style={{ textAlign: "center", color: hint ? T.ink : undefined }}>{hint || (canTakeDiscard ? "pesca dal mazzo, o prendi lo scarto per usarlo subito" : "pesca dal mazzo")}</Micro>
          )}
          {mine && gs.phase === "meld" && jokerAsk && (
            <div>
              <Micro style={{ textAlign: "center" }}>Il jolly rappresenta:</Micro>
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {jokerAsk.options.map((o) => (
                  <button
                    key={`${o.suit}${o.rank}`}
                    onClick={() => {
                      const done = jokerAsk.done;
                      setJokerAsk(null);
                      done({ s: o.suit, v: o.rank });
                    }}
                    style={{ background: "transparent", border: `1.5px solid ${T.ink}`, borderRadius: 12, padding: "8px 12px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
                  >
                    <S40Card card={{ id: "opt", s: o.suit, v: o.rank }} w={34} h={48} />
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button onClick={() => setJokerAsk(null)} style={{ ...plain }}>
                  annulla
                </button>
              </div>
            </div>
          )}
          {mine && gs.phase === "meld" && !jokerAsk && (
            <div>
              <div style={{ minHeight: 16 }}>
                <Micro style={{ textAlign: "center", color: hint || selMeld.ok ? T.ink : undefined }}>
                  {hint
                    ? hint
                    : selMeld.ok
                    ? `${selMeld.kind === "set" ? "tris" : "scala"} valida · ${selMeld.value} punti`
                    : !opened && staged.length > 0
                    ? `apertura ${stagedTotal}/40${stagedTotal < 40 ? " — aggiungi combinazioni" : " — puoi aprire"}`
                    : opened && sel.length === 1
                    ? "scarta, o tocca una combinazione per attaccare"
                    : opened
                    ? "cala una combinazione, o scarta una carta"
                    : "componi almeno 40 punti per aprire"}
                </Micro>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {opened ? (
                  <Button full soft={!selMeld.ok} onClick={doCala}>
                    Cala
                  </Button>
                ) : (
                  <>
                    <Button kind="line" soft={!selMeld.ok} onClick={doAggiungi}>
                      Aggiungi
                    </Button>
                    <Button full soft={stagedTotal < 40} onClick={doApri}>
                      Apri {staged.length ? `· ${stagedTotal}` : ""}
                    </Button>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", justifyContent: "space-between" }}>
                <Button kind="line" full soft={sel.length !== 1} onClick={doScarta}>
                  Scarta
                </Button>
                {(sel.length > 0 || staged.length > 0) && (
                  <button
                    onClick={() => {
                      setSel([]);
                      setStaged([]);
                      setHint("");
                    }}
                    style={{ ...plain, whiteSpace: "nowrap" }}
                  >
                    annulla
                  </button>
                )}
              </div>
            </div>
          )}
        </FloatBar>
      )}
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
  // Hold the deck to keep shuffling rapidly; a quick tap still shuffles once.
  // The interval calls through a ref so each tick uses the latest deck state
  // (otherwise a stale closure would re-shuffle from the same starting count).
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const holdRef = useRef(null);
  const startHold = () => {
    tapRef.current();
    if (holdRef.current) return;
    holdRef.current = setInterval(() => tapRef.current(), 110);
  };
  const stopHold = () => {
    if (holdRef.current) {
      clearInterval(holdRef.current);
      holdRef.current = null;
    }
  };
  useEffect(() => () => stopHold(), []);

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
          Tocca il mazzo per mescolare — o tienilo premuto per mescolare veloce. Il ritmo delle tue dita decide le carte.
        </p>
        <button
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            margin: "26px 0 8px",
            cursor: "pointer",
            touchAction: "manipulation",
            userSelect: "none",
            WebkitUserSelect: "none",
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

/* ── summaries — the detail under the finale, no repeated headline ── */
function Summary({ room, gs }) {
  if (scopaLike(room.game) && gs.summary)
    return (
      <div>
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
        {gs.scopeCards &&
          ["A", "B"].map(
            (s) =>
              (gs.scopeCards[s] || []).length > 0 && (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" }}>
                  <Micro style={{ minWidth: 54 }}>Scope {who(room, s)}</Micro>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {gs.scopeCards[s].map((cards, i) => (
                      <div key={i} style={{ display: "flex" }}>
                        {cards.map((c, j) => (
                          <div key={j} style={{ marginLeft: j ? -20 : 0 }}>
                            <Card card={c} size="xs" rot={0} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )
          )}
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
  if (room.game === "scala" && gs.penalty != null)
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18 }}>{gs.penalty} di penalità</div>
        <Micro style={{ marginTop: 4 }}>
          a {who(room, other(gs.win))} · mani {gs.tally.A}–{gs.tally.B}
        </Micro>
      </div>
    );
  if (room.game === "condottieri")
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {gs.how === "castle" ? (
            <>Castello espugnato <Ico n="castle" s={16} /></>
          ) : gs.how === "timeout" ? (
            "Tempo scaduto"
          ) : gs.win ? (
            <>Campo sterminato <Ico n="sword" s={16} /></>
          ) : (
            "Pareggio"
          )}
        </div>
        <Micro style={{ marginTop: 4 }}>battaglie {gs.tally.A}–{gs.tally.B}</Micro>
      </div>
    );
  return (
    <Micro style={{ textAlign: "center" }}>
      mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
    </Micro>
  );
}
