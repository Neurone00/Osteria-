import { useState, useEffect, useLayoutEffect, useRef, useCallback, createContext, useContext } from "react";

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
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"; // one mono stack everywhere
// Interface language. Italian is the default and the reference copy; every other
// system language gets English. `L(it, en)` picks the string for the current
// language — a module global set once per App render, read by every component.
let LANG = "it";
const L = (it, en) => (LANG === "en" && en != null ? en : it);
const systemLang = () => (typeof navigator !== "undefined" && /^it/i.test(navigator.language || navigator.userLanguage || "") ? "it" : "en");
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
const who = (room, s) => room.names[s] || (s === "A" ? L("Oste", "Host") : L("Ospite", "Guest"));
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
    en: { tag: "3 cards each", line: "Take a card of equal value, or a sum. Clear the table to score a scopa." },
    opts: [
      { k: "target", label: "Partita a", cycle: [11, 16, 21], hint: "Punti che chiudono la partita", le: "Game to", he: "Points that end the game" },
      { k: "asso", label: "Asso piglia tutto", cycle: [false, true], hint: "L’asso raccoglie tutte le carte del tavolo", le: "Ace takes all", he: "An ace sweeps every card on the table" },
      { k: "acepile", label: "Asso solo va in pila", cycle: [false, true], hint: "Un asso giocato su tavolo vuoto va in presa, non resta scoperto", le: "Lone ace to pile", he: "An ace on an empty table is captured, not left face-up" },
      { k: "rebello", label: "Rebello", cycle: [false, true], hint: "Un punto extra a chi prende il re di denari", le: "Rebello", he: "Extra point for taking the king of coins" },
      { k: "napola", label: "Napola", cycle: [false, true], hint: "Bonus per l’asso, il due e il tre di denari nella stessa pila", le: "Napola", he: "Bonus for the ace, two and three of coins in one pile" },
    ],
    def: { target: 11, asso: false, acepile: false, rebello: false, napola: false },
  },
  scienza: {
    name: "Scopa scientifica",
    tag: "5 in mano, tavolo vuoto",
    line: "Come la scopa, ma cinque carte in mano e niente sul tavolo: più memoria, più strategia.",
    en: { tag: "5 in hand, empty table", line: "Like scopa, but five cards in hand and nothing on the table: more memory, more strategy." },
    opts: [
      { k: "target", label: "Partita a", cycle: [11, 16, 21], hint: "Punti che chiudono la partita", le: "Game to", he: "Points that end the game" },
      { k: "asso", label: "Asso piglia tutto", cycle: [false, true], hint: "L’asso raccoglie tutte le carte del tavolo", le: "Ace takes all", he: "An ace sweeps every card on the table" },
      { k: "rebello", label: "Rebello", cycle: [false, true], hint: "Un punto extra a chi prende il re di denari", le: "Rebello", he: "Extra point for taking the king of coins" },
      { k: "napola", label: "Napola", cycle: [false, true], hint: "Bonus per l’asso, il due e il tre di denari nella stessa pila", le: "Napola", he: "Bonus for the ace, two and three of coins in one pile" },
    ],
    def: { target: 11, hand: 5, notable: true, asso: false, acepile: false, rebello: false, napola: false },
  },
  ruba: {
    name: "Rubamazzo",
    tag: "ruba il mazzo",
    line: "Abbina il tavolo per raccogliere. Abbina la cima di un mazzo e lo rubi tutto.",
    en: { tag: "steal the pile", line: "Match the table to collect. Match the top of a pile and steal the whole thing." },
    opts: [
      { k: "sums", label: "Somme del nord", cycle: [false, true], hint: "Prendi anche abbinando la somma di più carte del tavolo", le: "Northern sums", he: "Also capture by matching the sum of several table cards" },
      { k: "pilesum", label: "Mazzo nelle somme", cycle: [false, true], hint: "La cima del mazzo avversario conta nelle somme", le: "Pile in sums", he: "The opponent's top pile card counts in sums" },
    ],
    def: { sums: false, pilesum: false },
  },
  camicia: {
    name: "Straccia camicia",
    tag: "niente scelte, solo nervi",
    line: "Gira la carta in cima. Asso, due e tre fanno pagare 1, 2 o 3 all’altro.",
    en: { tag: "no choices, just nerve", line: "Flip the top card. Ace, two and three make the other pay 1, 2 or 3." },
    opts: [{ k: "intl", label: "Variante figure", cycle: [false, true], hint: "Anche le figure fanno pagare: Asso 4, Re 3, Cavallo 2, Fante 1", le: "Face-card variant", he: "Face cards charge too: Ace 4, King 3, Knight 2, Jack 1" }],
    def: { intl: false },
  },
  briscola: {
    name: "Briscola",
    tag: "la briscola comanda",
    line: "Prendi con la carta più forte, o taglia con una briscola. Chi fa più punti su 120 vince.",
    en: { tag: "trumps rule", line: "Take with the stronger card, or cut with a trump. Most points out of 120 wins." },
    opts: [],
    def: {},
  },
  perudo: {
    name: "Perudo",
    tag: "dadi e bugie",
    line: "Cinque dadi a testa, nascosti. Rilancia sulla quantità di una faccia (gli 1 sono jolly) o grida Dubito.",
    en: { tag: "dice and lies", line: "Five hidden dice each. Raise the count of a face (1s are wild) or call the bluff." },
    dice: true,
    opts: [],
    def: {},
  },
  yahtzee: {
    name: "Yahtzee",
    tag: "cinque dadi, tre tiri",
    line: "Tira fino a tre volte tenendo i dadi che vuoi, poi segna in una casella. Più punti in tredici turni.",
    en: { tag: "five dice, three rolls", line: "Roll up to three times, keeping the dice you want, then fill a box. Most points in thirteen turns." },
    dice: true,
    opts: [],
    def: {},
  },
  diecimila: {
    name: "Diecimila",
    tag: "sei dadi, o la va o la spacca",
    line: "Rilancia per accumulare, ma un tiro che non vale niente — Farkle — brucia tutto. Incassa quando vuoi. Primo al traguardo, poi l’altro ha un ultimo giro.",
    en: { tag: "six dice, push your luck", line: "Roll on to pile up points, but a roll that scores nothing — a Farkle — burns the lot. Bank when you like. First to the target, then the other gets one last turn." },
    dice: true,
    opts: [
      { k: "target", label: "Partita a", cycle: [2500, 5000, 10000], hint: "Punti che chiudono la partita", le: "Game to", he: "Points that end the game" },
      { k: "entry", label: "Punti per aprire", cycle: [false, true], hint: "Servono 500 in un turno prima del primo incasso", le: "Opening points", he: "You need 500 in one turn before your first bank" },
      { k: "lastRound", label: "Ultimo giro", cycle: [true, false], hint: "Chi arriva al traguardo lascia all’altro un turno per rimontare", le: "Last round", he: "Reaching the target gives the other one turn to overtake" },
    ],
    def: { target: 5000, entry: false, lastRound: true },
  },
  scala: {
    name: "Scala 40",
    tag: "aprire a quaranta",
    line: "Due mazzi francesi più due jolly. Cala tris e scale, apri con almeno 40 punti, poi attacca e svuota la mano.",
    en: { tag: "open at forty", line: "Two French decks plus two jokers. Lay sets and runs, open with at least 40 points, then attack and empty your hand." },
    big: true, // its own 106-card deck — no shuffle/cut ritual
    opts: [],
    def: {},
  },
  peppa: {
    name: "Peppa Tencia",
    tag: "chi resta con la Peppa",
    line: "Si tolgono tre cavalli: uno resta spaiato, la Peppa. Scarta le coppie, poi pesca a caso dall’altro. Chi resta con la Peppa perde.",
    en: { tag: "don't be left with the Peppa", line: "Three knights are removed: one is left unpaired — the Peppa. Discard pairs, then draw blind from the other. Left holding the Peppa, you lose." },
    instant: true, // its own 37-card deck — no shuffle/cut ritual
    opts: [],
    def: {},
  },
  condottieri: {
    name: "Condottieri",
    tag: "dadi in battaglia",
    line: "Ogni pedina è un dado: la faccia è la vita, e ferito colpisce meno. Schiera vicino al castello, poi muovi e tira. Vinci sterminando l’altro o prendendone il castello.",
    en: { tag: "dice at war", line: "Every piece is a die: its face is its life, and wounded it hits softer. Deploy by your castle, then move and roll. Win by wiping out the other or taking their castle." },
    instant: true, // its own hex board — no card deck or shuffle ritual
    board: true, // a tactics board, not cards or dice-cups
    opts: [
      { k: "simple", label: "Regole essenziali", cycle: [false, true], hint: "Due classi, compagnia fissa di 4, mappa piccola, senza stendardi", le: "Essential rules", he: "Two classes, fixed company of 4, small map, no banners" },
      { k: "flagAtk", label: "Stendardi: +1 attacco", cycle: [false, true], hint: "Attaccare stando su uno stendardo fa +1 danno", le: "Banners: +1 attack", he: "Attacking from a banner deals +1 damage" },
      { k: "flagWin", label: "Re della collina", cycle: [false, true], hint: "Chi tiene tutti gli stendardi nello stesso momento vince", le: "King of the hill", he: "Hold every banner at once to win" },
      { k: "flagHeal", label: "Stendardi curano", cycle: [false, true], hint: "Sostare su uno stendardo cura +2", le: "Banners heal", he: "Resting on a banner heals +2" },
      { k: "random", label: "Posizioni casuali", cycle: [false, true], hint: "Castelli, fontane e stendardi in punti casuali a ogni partita", le: "Random positions", he: "Castles, fountains and banners in random spots each game" },
      { k: "passAllies", label: "Attraversa gli alleati", cycle: [false, true], hint: "Le pedine passano attraverso quelle amiche, ma non possono fermarcisi", le: "Pass through allies", he: "Pieces move through friendly ones, but can't stop on them" },
    ],
    def: { simple: false, flagAtk: true, flagWin: true, flagHeal: false, random: true, passAllies: false },
  },
  bestiario: {
    name: "Bestiario",
    tag: "cinque carte, due maestri",
    line: "Su una scacchiera 5×5, muovi le pedine con carte-animale che passano di mano a ogni mossa. Vinci catturando il Maestro avversario o portando il tuo sul suo tempio.",
    en: { tag: "five cards, two masters", line: "On a 5×5 board, move your pieces with animal cards that pass hands each turn. Win by capturing the enemy Master or walking yours onto their temple." },
    instant: true, // its own board — no card deck or shuffle ritual
    board: true,
    opts: [],
    def: {},
  },
};
// game meta + option labels/hints in the current language
const gtag = (g) => L(g.tag, g.en && g.en.tag);
const gline = (g) => L(g.line, g.en && g.en.line);
const isCard = (game) => !GAMES[game].dice;
// The shuffle-and-cut "mischia" ritual runs for every card game except the ones
// dealt instantly (Peppa's trimmed deck). Scala uses it too, on its own 106-card
// deck. `usesRitual` additionally gates the lobby's points/face toggles, which the
// big French-only Scala deck doesn't want — so keep it excluding `big`.
const usesShuffle = (game) => isCard(game) && !GAMES[game].instant;
const usesRitual = (game) => isCard(game) && !GAMES[game].big && !GAMES[game].instant;
// The deck the mischia shuffles — Scala brings its own 106-card French deck.
const ritualDeck = (game) => shuffle(game === "scala" ? makeS40Deck() : makeDeck());
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
      // carry the exact cards so both screens can show what the sweep took — the
      // table clears instantly, so this is the only record of the play in flight
      ev = { t: "scopa", card: { s: card.s, v: card.v }, got: got.map((c) => ({ s: c.s, v: c.v })) };
    } else {
      kind = "take";
      ev = { t: "take", v: card.v, s: card.s, got: got.map((c) => ({ s: c.s, v: c.v })) };
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
    reveal: { A: false, B: false }, // both must eye the trump before play begins
    done: false,
    matchDone: false,
    win: null,
  };
}
// each player taps the big trump to confirm they've seen it; play starts when both have
function briscolaReveal(gs, seat) {
  if (!gs.reveal || gs.reveal[seat]) return null;
  const g = clone(gs);
  g.reveal = { ...g.reveal, [seat]: true };
  return { g, quiet: true, ev: { t: "reveal" } };
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
  return { g, kind: "take", nojolt: true, ev: { t: "roll" } };
}
function yahtToggle(gs, seat, i) {
  const g = clone(gs);
  if (g.turn !== seat || !g.rolled || g.done) return null;
  g.keep[i] = !g.keep[i];
  return { g, kind: "lay", nojolt: true, ev: { t: "keep" } };
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
  return { g, kind: "scopa", nojolt: true, ev: { t: "score", cat } };
}

/* ── diecimila (farkle) ────────────────────────────────────────
   The traditional osteria press-your-luck dice game. Six dice; a turn keeps
   re-rolling to pile up points, but a roll that scores nothing at all — a
   Farkle — wipes the whole turn. Scoring:
     · a single 1 = 100, a single 5 = 50
     · three 1s = 1000, three of any other = face × 100 (2→200 … 6→600)
     · four/five/six of a kind double the triple, again, and again (×2, ×4, ×8)
     · a 1–6 straight = 1500, three pairs = 1500
   Each roll you set aside at least one scoring die, then bank or roll on. Clear
   all six and they're "hot" — roll all six afresh, points carried. First to the
   target opens a last round; the other gets one turn to overtake. */

// Points for a chosen set of dice, but only if EVERY die earns — otherwise null,
// so a selection with a dead die (a lone 2/3/4/6) is rejected, not silently
// under-counted.
function farkleSelectionScore(vals) {
  if (!vals || !vals.length) return null;
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of vals) c[v]++;
  if (vals.length === 6) {
    if (c.slice(1).every((n) => n === 1)) return 1500; // straight 1–6
    if (c.slice(1).filter((n) => n === 2).length === 3) return 1500; // three pairs
  }
  let score = 0;
  for (let f = 1; f <= 6; f++) {
    const n = c[f];
    if (!n) continue;
    if (n >= 3) score += (f === 1 ? 1000 : f * 100) * Math.pow(2, n - 3);
    else if (f === 1) score += n * 100;
    else if (f === 5) score += n * 50;
    else return null; // a 2/3/4/6 outside a triple is dead — illegal selection
  }
  return score;
}
// Is any scoring possible in this roll? Drives Farkle detection.
function farkleHasScore(vals) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of vals) c[v]++;
  if (c[1] || c[5]) return true; // a straight always has these too
  if (c[2] >= 3 || c[3] >= 3 || c[4] >= 3 || c[6] >= 3) return true;
  if (vals.length === 6 && c.slice(1).filter((n) => n === 2).length === 3) return true; // three pairs, no 1/5
  return false;
}
function dealFarkle(dealer, tally, opts) {
  return {
    turn: dealer,
    dice: [], // the current live roll, awaiting the player's pick
    live: 6, // dice still to roll this segment
    kept: [], // dice set aside this turn (values), for display
    turnScore: 0, // points banked-aside this turn, not yet safe
    rolled: false, // are `dice` a fresh roll waiting to be picked from?
    farkle: false, // the last roll busted (drives the reveal)
    hot: false, // all six were cleared — a fresh six is coming
    scores: { A: 0, B: 0 },
    target: opts?.target || 5000,
    entry: opts?.entry ? 500 : 0, // points needed to make your first bank
    lastRound: opts?.lastRound !== false, // catch-up final turn (default on)
    trigger: null, // seat that reached the target — the final round is underway
    dealer,
    tally: tally || { A: 0, B: 0 },
    summary: null,
    done: false,
    matchDone: false,
    win: null,
  };
}
// Wrap up a turn: reset the per-turn pot and either hand over or, if the
// catch-up round is done, settle the game.
function farkleEndTurn(g, seat) {
  g.turnScore = 0;
  g.kept = [];
  g.live = 6;
  g.rolled = false;
  g.hot = false;
  const finalOver = g.trigger != null && (seat === other(g.trigger) || !g.lastRound);
  if (finalOver) {
    const a = g.scores.A,
      b = g.scores.B;
    g.win = a === b ? null : a > b ? "A" : "B";
    if (g.win) g.tally[g.win] += 1;
    g.summary = { a, b, win: g.win };
    g.done = true;
    g.matchDone = true;
    return g;
  }
  g.turn = other(seat);
  return g;
}
// Set aside the chosen dice (indices into the live roll). Mutates g; returns the
// points gained, or null if the pick is illegal.
function farkleTake(g, seat, sel) {
  if (g.turn !== seat || g.done || !g.rolled || !sel || !sel.length) return null;
  if (new Set(sel).size !== sel.length) return null;
  if (sel.some((i) => i < 0 || i >= g.dice.length)) return null;
  const vals = sel.map((i) => g.dice[i]);
  const pts = farkleSelectionScore(vals);
  if (pts == null || pts === 0) return null;
  g.turnScore += pts;
  g.kept = g.kept.concat(vals);
  g.live -= sel.length;
  g.rolled = false;
  if (g.live === 0) {
    g.live = 6; // hot dice — a whole fresh six, points carried
    g.kept = [];
    g.hot = true;
  }
  return pts;
}
// The opening roll of a turn (nothing to set aside yet). A dead roll busts.
function farkleRoll(gs, seat) {
  const g = clone(gs);
  if (g.turn !== seat || g.done || g.rolled) return null;
  g.dice = rollN(g.live);
  g.rolled = true;
  g.hot = false;
  g.farkle = false;
  if (!farkleHasScore(g.dice)) {
    g.farkle = true;
    g.turnScore = 0;
    farkleEndTurn(g, seat);
    return { g, kind: "lay", nojolt: true, ev: { t: "farkle" } };
  }
  return { g, kind: "take", nojolt: true, ev: { t: "roll" } };
}
// Set the pick aside, then roll on (risking a Farkle).
function farkleRollOn(gs, seat, sel) {
  const g = clone(gs);
  if (farkleTake(g, seat, sel) == null) return null;
  g.dice = rollN(g.live);
  g.rolled = true;
  g.farkle = false;
  if (!farkleHasScore(g.dice)) {
    g.farkle = true;
    g.turnScore = 0;
    farkleEndTurn(g, seat);
    return { g, kind: "lay", nojolt: true, ev: { t: "farkle" } };
  }
  return { g, kind: "take", nojolt: true, ev: { t: "roll", hot: g.hot } };
}
// Set the pick aside and bank the turn's points.
function farkleBank(gs, seat, sel) {
  const g = clone(gs);
  const pts = farkleTake(g, seat, sel);
  if (pts == null) return null;
  const gained = g.turnScore;
  if (g.entry && g.scores[seat] === 0 && gained < g.entry) return null; // not enough to open
  g.scores[seat] += gained;
  if (g.trigger == null && g.scores[seat] >= g.target) g.trigger = seat; // opens the last round
  farkleEndTurn(g, seat);
  return { g, kind: "scopa", ev: { t: "bank", pts: gained } };
}

/* ── bestiario (onitama) ───────────────────────────────────────
   A 5×5 board duel. Each side has a Maestro and four Allievi on its back row,
   the Maestro on the central temple. Five animal cards are dealt from sixteen —
   two to each player, one left aside as the "spare". A card is a set of relative
   steps; on your turn you spend one of your two cards to move a piece by its
   pattern, then that card goes to the spare and you take the spare into hand, so
   the moves keep rotating between the players. Win by capturing the enemy Maestro
   (Via della Spada) or by walking your own Maestro onto the enemy's temple (Via
   del Fiume). Perfect information — nothing hidden — so it sits cleanly on the
   shared-state wire. Moves are stored as {f,s}: f steps forward (toward the
   enemy), s steps to the mover's right; seat B applies them rotated 180°. */
const BEST_CARDS = [
  { id: "tigre", name: "Tigre", en: "Tiger", moves: [{ f: 2, s: 0 }, { f: -1, s: 0 }] },
  { id: "drago", name: "Drago", en: "Dragon", moves: [{ f: 1, s: -2 }, { f: 1, s: 2 }, { f: -1, s: -1 }, { f: -1, s: 1 }] },
  { id: "rana", name: "Rana", en: "Frog", moves: [{ f: 1, s: -1 }, { f: 0, s: -2 }, { f: -1, s: 1 }] },
  { id: "coniglio", name: "Coniglio", en: "Rabbit", moves: [{ f: 1, s: 1 }, { f: 0, s: 2 }, { f: -1, s: -1 }] },
  { id: "granchio", name: "Granchio", en: "Crab", moves: [{ f: 1, s: 0 }, { f: 0, s: -2 }, { f: 0, s: 2 }] },
  { id: "elefante", name: "Elefante", en: "Elephant", moves: [{ f: 1, s: -1 }, { f: 1, s: 1 }, { f: 0, s: -1 }, { f: 0, s: 1 }] },
  { id: "oca", name: "Oca", en: "Goose", moves: [{ f: 1, s: -1 }, { f: 0, s: -1 }, { f: 0, s: 1 }, { f: -1, s: 1 }] },
  { id: "gallo", name: "Gallo", en: "Rooster", moves: [{ f: 1, s: 1 }, { f: 0, s: 1 }, { f: 0, s: -1 }, { f: -1, s: -1 }] },
  { id: "scimmia", name: "Scimmia", en: "Monkey", moves: [{ f: 1, s: -1 }, { f: 1, s: 1 }, { f: -1, s: -1 }, { f: -1, s: 1 }] },
  { id: "mantide", name: "Mantide", en: "Mantis", moves: [{ f: 1, s: -1 }, { f: 1, s: 1 }, { f: -1, s: 0 }] },
  { id: "cavallo", name: "Cavallo", en: "Horse", moves: [{ f: 1, s: 0 }, { f: 0, s: -1 }, { f: -1, s: 0 }] },
  { id: "bue", name: "Bue", en: "Ox", moves: [{ f: 1, s: 0 }, { f: 0, s: 1 }, { f: -1, s: 0 }] },
  { id: "gru", name: "Gru", en: "Crane", moves: [{ f: 1, s: 0 }, { f: -1, s: -1 }, { f: -1, s: 1 }] },
  { id: "cinghiale", name: "Cinghiale", en: "Boar", moves: [{ f: 1, s: 0 }, { f: 0, s: -1 }, { f: 0, s: 1 }] },
  { id: "anguilla", name: "Anguilla", en: "Eel", moves: [{ f: 1, s: -1 }, { f: 0, s: 1 }, { f: -1, s: -1 }] },
  { id: "cobra", name: "Cobra", en: "Cobra", moves: [{ f: 1, s: 1 }, { f: 0, s: -1 }, { f: -1, s: 1 }] },
];
const BEST_CARD = Object.fromEntries(BEST_CARDS.map((c) => [c.id, c]));
const BEST_TEMPLE = { A: 2, B: 22 }; // each seat's home temple = centre of its back row
const bestCardName = (c) => L(c.name, c.en);
// Absolute target of applying move `m` to a piece at `idx` for `seat`.
function bestTarget(seat, idx, m) {
  const r = (idx / 5) | 0,
    c = idx % 5;
  const tr = seat === "A" ? r + m.f : r - m.f;
  const tc = seat === "A" ? c + m.s : c - m.s;
  if (tr < 0 || tr > 4 || tc < 0 || tc > 4) return -1;
  return tr * 5 + tc;
}
// Legal destinations for the piece at `from` using one specific card.
function bestDests(g, seat, from, cardId) {
  const p = g.board[from];
  if (!p || p.seat !== seat || !g.cards[seat].includes(cardId)) return [];
  const out = [];
  for (const m of BEST_CARD[cardId].moves) {
    const to = bestTarget(seat, from, m);
    if (to < 0) continue;
    const occ = g.board[to];
    if (occ && occ.seat === seat) continue; // never land on your own
    out.push(to);
  }
  return out;
}
// Does `seat` have any legal move at all (across both cards, every piece)?
function bestAnyMove(g, seat) {
  for (let i = 0; i < 25; i++) {
    const p = g.board[i];
    if (!p || p.seat !== seat) continue;
    for (const cid of g.cards[seat]) if (bestDests(g, seat, i, cid).length) return true;
  }
  return false;
}
function dealBestiario(dealer, tally) {
  const ids = shuffle(BEST_CARDS.map((c) => c.id)).slice(0, 5);
  const board = Array(25).fill(null);
  for (const c of [0, 1, 3, 4]) board[c] = { seat: "A", master: false };
  board[2] = { seat: "A", master: true };
  for (const c of [0, 1, 3, 4]) board[20 + c] = { seat: "B", master: false };
  board[22] = { seat: "B", master: true };
  const start = Math.random() < 0.5 ? "A" : "B"; // the spare card's colour decides who leads
  return {
    board,
    cards: { A: [ids[0], ids[1]], B: [ids[2], ids[3]], spare: ids[4] },
    spareSide: start,
    turn: start,
    last: null,
    dealer,
    tally: tally || { A: 0, B: 0 },
    done: false,
    matchDone: false,
    win: null,
    how: null,
  };
}
// Spend `cardId` to move the piece at `from` to `to`, then rotate that card out
// to the spare. Wins on capturing the enemy Maestro or reaching its temple.
function bestiarioPlay(gs, seat, from, to, cardId) {
  const g = clone(gs);
  if (g.turn !== seat || g.done || !g.cards[seat].includes(cardId)) return null;
  const p = g.board[from];
  if (!p || p.seat !== seat) return null;
  if (!bestDests(g, seat, from, cardId).includes(to)) return null;
  const occ = g.board[to];
  const capture = occ ? { seat: occ.seat, master: occ.master } : null;
  g.board[to] = p;
  g.board[from] = null;
  g.cards[seat] = g.cards[seat].map((x) => (x === cardId ? g.cards.spare : x));
  g.cards.spare = cardId;
  g.last = { from, to, cardId, seat, capture };
  if (capture && capture.master) {
    g.win = seat;
    g.how = "capture";
  } else if (p.master && to === BEST_TEMPLE[other(seat)]) {
    g.win = seat;
    g.how = "temple";
  }
  if (g.win) {
    g.done = true;
    g.matchDone = true;
    g.tally[g.win] += 1;
  } else g.turn = other(seat);
  return { g, kind: capture ? "scopa" : "take", ev: { t: "move", capture: !!capture, how: g.how } };
}
// Stuck: no legal move anywhere, so you forfeit the move and just swap a card.
function bestiarioPass(gs, seat, cardId) {
  const g = clone(gs);
  if (g.turn !== seat || g.done || !g.cards[seat].includes(cardId)) return null;
  if (bestAnyMove(g, seat)) return null; // only legal when truly stuck
  g.cards[seat] = g.cards[seat].map((x) => (x === cardId ? g.cards.spare : x));
  g.cards.spare = cardId;
  g.last = { pass: true, cardId, seat };
  g.turn = other(seat);
  return { g, kind: "lay", nojolt: true, ev: { t: "pass" } };
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
// k-combinations of an array (small arrays only — used for tris/poker sets).
function kcombos(arr, k) {
  if (k > arr.length) return [];
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return out.push(acc.slice());
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}
// Every valid meld (tris/poker/scala, ≤1 joker) that can be built from a pool of
// cards. analyzeMeld is the source of truth — we only propose plausible groups.
function s40MeldCandidates(pool) {
  const nats = pool.filter((c) => !c.joker);
  const joker = pool.find((c) => c.joker) || null; // a meld holds at most one joker
  const out = [];
  const seen = new Set();
  const push = (cards) => {
    if (cards.length < 3) return;
    if (!analyzeMeld(cards).ok) return;
    const k = cards.map((c) => c.id).sort().join(",");
    if (seen.has(k)) return;
    seen.add(k);
    out.push(cards);
  };
  // SETS — same rank, distinct suits, optionally one joker
  const byRank = {};
  for (const c of nats) (byRank[c.v] = byRank[c.v] || []).push(c);
  for (const v in byRank) {
    const bySuit = {};
    for (const c of byRank[v]) if (!bySuit[c.s]) bySuit[c.s] = c; // one per suit
    const ds = Object.values(bySuit);
    for (const cmb of kcombos(ds, 3)) push(cmb);
    for (const cmb of kcombos(ds, 4)) push(cmb);
    if (joker) for (const cmb of [...kcombos(ds, 2), ...kcombos(ds, 3)]) push([...cmb, joker]);
  }
  // RUNS — same suit, consecutive ranks (ace low or high), at most one joker gap
  const bySuit = {};
  for (const c of nats) (bySuit[c.s] = bySuit[c.s] || []).push(c);
  for (const s in bySuit) {
    const rc = {}; // rank → a card of this suit (ace also offered as 14)
    for (const c of bySuit[s]) {
      if (!rc[c.v]) rc[c.v] = c;
      if (c.v === 1 && !rc[14]) rc[14] = c;
    }
    for (let L = 3; L <= 13; L++)
      for (let lo = 1; lo + L - 1 <= 14; lo++) {
        const hi = lo + L - 1;
        const cards = [];
        let gaps = 0;
        for (let r = lo; r <= hi; r++) (rc[r] ? cards.push(rc[r]) : gaps++);
        if (gaps === 0) push(cards);
        else if (gaps === 1 && joker) push([...cards, joker]);
      }
  }
  return out;
}
// Can this seat OPEN (lay melds worth ≥40) using `top` in one of them? A packing
// search over the candidate melds: disjoint melds, ≥40 total, top card included.
function s40CanOpenWith(hand, top) {
  const pool = [...hand, top];
  const bit = {};
  pool.forEach((c, i) => (bit[c.id] = 1 << i));
  const topBit = bit[top.id];
  const cands = s40MeldCandidates(pool)
    .map((cards) => {
      let mask = 0;
      for (const c of cards) mask |= bit[c.id];
      return { mask, value: analyzeMeld(cards).value, hasTop: (mask & topBit) !== 0 };
    })
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const n = cands.length;
  if (!n) return false;
  const sufVal = new Array(n + 1).fill(0);
  const sufTop = new Array(n + 1).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    sufVal[i] = sufVal[i + 1] + cands[i].value;
    sufTop[i] = sufTop[i + 1] || cands[i].hasTop;
  }
  const memo = new Set();
  const dfs = (i, used, total, topUsed) => {
    if (topUsed && total >= 40) return true;
    if (i >= n || total + sufVal[i] < 40) return false;
    if (!topUsed && !sufTop[i]) return false; // no way left to include the taken card
    const key = i + ":" + used + ":" + (topUsed ? 1 : 0);
    if (memo.has(key)) return false;
    memo.add(key);
    if (dfs(i + 1, used, total, topUsed)) return true; // skip meld i
    const c = cands[i];
    if ((c.mask & used) === 0 && dfs(i + 1, used | c.mask, total + c.value, topUsed || c.hasTop)) return true;
    return false;
  };
  return dfs(0, 0, 0, false);
}
// The top of the scarti can be taken only if it can be used at once. Before you
// open, that means only if this exact card lets you go down with ≥40 (it must
// slot into a combination that reaches the opening). Once opened, it's enough
// that it lays onto a table meld or forms a fresh meld with two hand cards.
// Drawing from the mazzo is always free.
function s40CanUseDiscard(gs, seat) {
  const top = gs.discard[gs.discard.length - 1];
  if (!top) return false;
  const hand = gs.hands[seat];
  if (!gs.opened[seat]) return s40CanOpenWith(hand, top);
  for (const m of gs.melds) if (analyzeMeld([...m.cards, top]).ok) return true;
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
   explodes for a crit. Seven classes (Fante, Arciere, Esploratore, Aquila,
   Balestriere, Fromboliere, Mago — the Aquila flies over obstacles and is safe
   from melee while perched on one; the Mago aims two adjacent hexes and hits every
   unit in them, friend or foe), each a die with its own move, range and point cost; draft a company
   under a budget. Deploy near your castle, then fight in strict alternation —
   one move each, back and forth. A unit may move twice, then it rests for a turn
   (a side's lone survivor never rests, so it's never stuck). Heal at your castle
   (full) or a fountain (+3) — fountains sit on the flanks, across from the
   castles, so healing means leaving your line. Contested flags out in the field
   add +1 to an attack made from one, and holding every flag at once wins outright.
   A castle bombards any enemy that ends beside it for 2. Win by wiping the enemy,
   holding their castle (step in, survive their answer), or seizing all the flags.
   Otherwise the battle ends after a fixed number of moves, decided on flags held,
   then total HP. Obstacles block movement and line of sight; there is no
   elevation. A house-rule toggle plays the essential version: two classes, a
   fixed company of four, a small board, no flags. */
const TACT = {
  R: 10, // map radius — a hexagon this many rings across, then eroded to an irregular coast
  ERODE: 0.34, // chance a border hex is chipped away each pass (2 passes) → random shape
  BLOCK: 0.2, // share of the open interior turned to rubble — cover + broken lines of sight
  DEPLOY_R: 3, // deploy within this many hexes of your castle (room for a full company)
  MOVE_CAP: 40, // no turns: either side moves freely, the battle ends after this many moves total
  SIEGE_STALL: 3, // if the enemy won't answer a siege, the keep falls after this many moves anyway
  ACTS: 2, // moves a single unit may spend before it must rest — you can move the same one twice
  CASTLE_DMG: 2, // a castle bombards any enemy that ends its turn next to it
  FLAG_DMG: 1, // attacking while you stand on a flag adds this much damage
  BUDGET: 15, // points to spend drafting a company
  MIN_UNITS: 3,
  MAX_UNITS: 6,
  // The essential game (a house-rule toggle): small board, two classes, a fixed
  // company of 4, no banners — the shape this game had before the draft update.
  SIMPLE_R: 8,
  SIMPLE_DEPLOY_R: 2,
  SIMPLE_UNITS: 4,
  // A pool of five classes, each a die (max = starting HP) with its own move,
  // attack range (min..rng) and point cost. A wounded die hits weaker, so HP is
  // both life and damage. Draft a company under the budget: cheap skirmishers in
  // numbers, or a few heavy specialists.
  units: {
    fante: { name: "Fante", max: 8, move: 2, min: 1, rng: 1, cost: 3, icon: "sword" }, // d8 melee bruiser
    arciere: { name: "Arciere", max: 6, move: 2, min: 2, rng: 3, cost: 3, icon: "bow" }, // d6 kite, 2–3 away
    esploratore: { name: "Esploratore", max: 2, move: 4, min: 1, rng: 1, cost: 3, icon: "compass" }, // d2 scout: races across the map, but soft (two hits and it's gone)
    aquila: { name: "Aquila", max: 3, move: 3, min: 1, rng: 1, cost: 4, icon: "eagle", fly: true }, // d3 flyer: crosses obstacles, and perched on one it's safe from melee
    balestriere: { name: "Balestriere", max: 8, move: 1, min: 2, rng: 4, cost: 5, icon: "crossbow" }, // d8 slow sniper, 2–4
    fromboliere: { name: "Fromboliere", max: 4, move: 3, min: 1, rng: 2, cost: 2, icon: "sling" }, // d4 cheap skirmisher
    mago: { name: "Mago", max: 4, move: 2, min: 2, rng: 3, cost: 5, icon: "spark", aoe: true }, // d4 area caster: aims two adjacent hexes, hits friend and foe in both
  },
};
const TYPE_ORDER = ["fante", "arciere", "esploratore", "aquila", "balestriere", "fromboliere", "mago"];
// A drafted company is legal when it has 3..6 units and fits the budget.
function tacticsCompanyCost(company) {
  return company.reduce((t, type) => t + (TACT.units[type]?.cost || 0), 0);
}
function tacticsCompanyLegal(company) {
  if (!Array.isArray(company) || company.length < TACT.MIN_UNITS || company.length > TACT.MAX_UNITS) return false;
  if (company.some((type) => !TACT.units[type])) return false;
  return tacticsCompanyCost(company) <= TACT.BUDGET;
}
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
// Board shape by mode: the essential (simple) game is a small board and no
// banners; the full game is bigger, with a roomier deploy zone and contested
// banners out in the field.
const tacticsShape = (simple, random) =>
  simple
    ? { R: TACT.SIMPLE_R, deployR: TACT.SIMPLE_DEPLOY_R, room: TACT.SIMPLE_UNITS, banners: 0, random: !!random }
    : { R: TACT.R, deployR: TACT.DEPLOY_R, room: TACT.MAX_UNITS, banners: 3, random: !!random };

// One attempt at an irregular island. Returns null if the shape can't seat both
// squads or can't stay connected once rubble is added, so the caller can retry.
function tacticsBoardTry(R, erode, shp) {
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
  // enough open room to deploy a full company next to a keep
  const deployRoom = (c) => cells.filter((x) => hdist(x, c) <= shp.deployR).length;
  // castles: the classic layout puts them at the far vertical ends; random mode
  // drops them anywhere, so long as they're far enough apart for two full,
  // separate deploy zones (never less than 3 hexes — here a clear gap).
  let cA, cB;
  if (shp.random) {
    const minSep = 2 * shp.deployR;
    for (let t = 0; t < 400 && !cA; t++) {
      const a = cells[(Math.random() * cells.length) | 0];
      const b = cells[(Math.random() * cells.length) | 0];
      if (hdist(a, b) < minSep || deployRoom(a) < shp.room || deployRoom(b) < shp.room) continue;
      cA = a;
      cB = b;
    }
    if (!cA) return null;
  } else {
    const midOf = (rr) => {
      const row = cells.filter((c) => c.r === rr).sort((a, b) => a.q - b.q);
      return row[Math.floor(row.length / 2)];
    };
    cA = midOf(rMax);
    cB = midOf(rMin);
    if (deployRoom(cA) < shp.room || deployRoom(cB) < shp.room) return null;
  }
  const castle = { A: hkey(cA.q, cA.r), B: hkey(cB.q, cB.r) };
  // fountains: classic layout sets them on the flanks (castles N/S → fountains
  // E/W), clear of both keeps; random mode scatters them off the deploy zones.
  let fA, fB;
  const outOfZones = (c) => hdist(c, cA) > shp.deployR && hdist(c, cB) > shp.deployR;
  if (shp.random) {
    const cand = cells.filter(outOfZones);
    fA = cand[(Math.random() * cand.length) | 0] || cA;
    const far = cand.filter((c) => hdist(c, fA) >= 3);
    const pool = far.length ? far : cand;
    fB = pool[(Math.random() * pool.length) | 0] || cB;
  } else {
    const sx = (c) => c.q + c.r / 2; // a hex's screen-x, for true left/right
    const rMid = (rMin + rMax) / 2;
    const flankBand = cells.filter((c) => Math.abs(c.r - rMid) <= Math.max(2, (rMax - rMin) * 0.22));
    const bandc = flankBand.length ? flankBand : cells;
    fA = bandc.reduce((a, b) => (sx(b) > sx(a) ? b : a));
    fB = bandc.reduce((a, b) => (sx(b) < sx(a) ? b : a));
  }
  const fount = { A: hkey(fA.q, fA.r), B: hkey(fB.q, fB.r) };
  const reserved = new Set([castle.A, castle.B, fount.A, fount.B]);
  const nearCastle = (c) => hdist(c, cA) <= shp.deployR || hdist(c, cB) <= shp.deployR;
  for (let attempt = 0; attempt < 60; attempt++) {
    const blocked = {};
    for (const c of cells) {
      const k = hkey(c.q, c.r);
      if (reserved.has(k) || nearCastle(c)) continue; // deploy zones + specials stay clear
      if (Math.random() < TACT.BLOCK) blocked[k] = true;
    }
    const openSet = new Set(cells.map((c) => hkey(c.q, c.r)).filter((k) => !blocked[k]));
    if (!tacticsConnected(openSet) || !openSet.has(castle.A) || !openSet.has(castle.B)) continue;
    // contested banners: open hexes out in the field, clear of both keeps and
    // spread apart, so neither side owns them and the middle is worth taking.
    const banners = [];
    if (shp.banners > 0) {
      const cand = [...openSet].map(unhkey).filter((c) => !reserved.has(hkey(c.q, c.r)) && hdist(c, cA) > shp.deployR && hdist(c, cB) > shp.deployR);
      if (shp.random) cand.sort(() => Math.random() - 0.5);
      else cand.sort((a, b) => Math.abs(a.r) - Math.abs(b.r) || hdist(a, { q: 0, r: 0 }) - hdist(b, { q: 0, r: 0 }));
      for (const c of cand) {
        if (banners.every((bk) => hdist(unhkey(bk), c) >= 3)) banners.push(hkey(c.q, c.r));
        if (banners.length >= shp.banners) break;
      }
    }
    return { cells, blocked, castle, fount, banners, deployR: shp.deployR };
  }
  return null;
}
// A big, irregular island: chew a hexagon's edges into a jagged coast, keep the
// largest piece, scatter rubble. Retries until it's playable; a plain hexagon
// (no erosion) is the always-works fallback.
function tacticsBoard(simple, random) {
  const shp = tacticsShape(simple, random);
  for (let tries = 0; tries < 60; tries++) {
    const b = tacticsBoardTry(shp.R, true, shp);
    if (b) return b;
  }
  return tacticsBoardTry(shp.R, false, shp) || tacticsBoardTry(shp.R - 1, false, shp);
}

function dealTactics(dealer, opts, tally) {
  const o = opts || {};
  const simple = !!o.simple;
  // house rules, baked onto the state so the engine reads them without threading opts
  const rules = { flagAtk: o.flagAtk !== false, flagWin: o.flagWin !== false, flagHeal: !!o.flagHeal, random: o.random !== false, passAllies: !!o.passAllies };
  return {
    simple, // essential rules: two classes, fixed company of 4, small board, no banners
    rules,
    board: tacticsBoard(simple, rules.random),
    phase: "setup", // setup (draft + place, hidden & at once) → battle
    setup: { A: null, B: null }, // each seat's locked-in placements; hidden until both are in
    units: {}, // id → { id, owner, type, hp, max, q, r }
    order: [], // stable unit ids
    turn: dealer || "A", // whose move it is (roster/deploy hand-off, and battle alternation)
    spent: {}, // unit id → moves used (capped at TACT.ACTS, then the unit rests)
    rest: {}, // unit id → the owner-turn index it started resting on
    turns: { A: 0, B: 0 }, // moves each side has made — drives the one-turn rest
    siege: null, // { seat, unitId, at, armed } — a unit sitting in the enemy castle
    moves: 0, // battle moves made by either side; the game ends at TACT.MOVE_CAP
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
  return hdist(unhkey(k), unhkey(g.board.castle[seat])) <= g.board.deployR;
}

// The essential company: exactly four, two classes, at least one of each.
function tacticsSimpleLegal(company) {
  return (
    Array.isArray(company) &&
    company.length === TACT.SIMPLE_UNITS &&
    company.every((t) => t === "fante" || t === "arciere") &&
    company.includes("fante") &&
    company.includes("arciere")
  );
}

// Roster and deployment happen at once and in private: each player drafts a
// company AND places it entirely on their own device, seeing nothing of the
// other's. Locking in writes only your own placements into a hidden slot; when
// both are in, every unit is built and the battle begins — the reveal. The two
// submits stay serialized by turn (dealer first) so they never race under the
// one-writer transport, but neither player waits to set up.
// `placements` is [{ type, q, r }] — the drafted company, each on a legal hex.
// Each seat locks in its own hidden company independently — no turn hand-off, so
// nothing hangs on a turn-flip message arriving. Whoever's write makes both
// companies present opens the battle; if two writes race and one is dropped, the
// losing seat simply re-submits (its slot is still empty) and converges.
function tacticsSetup(gs, seat, placements) {
  if (gs.done || gs.phase !== "setup") return null;
  if (gs.setup[seat] != null) return gs.setup[other(seat)] != null ? tacticsResolveSetup(gs) : null; // already in — open the battle if the other is in too
  if (!Array.isArray(placements)) return null;
  const types = placements.map((p) => p.type);
  const legal = gs.simple ? tacticsSimpleLegal(types) : tacticsCompanyLegal(types);
  if (!legal) return null;
  const g = clone(gs);
  const used = new Set();
  for (const p of placements) {
    const k = hkey(p.q, p.r);
    if (used.has(k)) return null;
    if (!tacticsOpen(g, k) || hdist(unhkey(k), unhkey(g.board.castle[seat])) > g.board.deployR) return null;
    used.add(k);
  }
  g.setup[seat] = placements.map((p) => ({ type: p.type, q: p.q, r: p.r }));
  if (g.setup[other(seat)] != null) tacticsOpenBattle(g); // both companies are in — reveal and fight
  return { g, quiet: true, ev: { t: "setup" } };
}
// Build every unit from the two hidden companies and open the battle. Shared by
// the second lock-in and the self-heal below.
function tacticsOpenBattle(g) {
  for (const s of ["A", "B"]) {
    for (const p of g.setup[s]) {
      const id = `${s}${p.type[0]}${g.order.length}`;
      g.units[id] = { id, owner: s, type: p.type, hp: TACT.units[p.type].max, max: TACT.units[p.type].max, q: p.q, r: p.r };
      g.order.push(id);
    }
  }
  g.phase = "battle";
  g.turn = g.dealer;
  g.moves = 0;
  g.spent = {};
  g.rest = {};
  g.turns = { A: 0, B: 0 };
  return g;
}
// Safety net: if both companies are somehow locked in but the battle never
// opened (a lost/duplicated setup write under the live transport), any seat can
// resolve it deterministically — the build is identical on both devices.
function tacticsResolveSetup(gs) {
  if (gs.done || gs.phase !== "setup" || !gs.setup || gs.setup.A == null || gs.setup.B == null) return null;
  const g = clone(gs);
  tacticsOpenBattle(g);
  return { g, quiet: true, ev: { t: "setup" } };
}

// Hexes a unit can step to (BFS to its Move, around obstacles and other units).
function tacticsReach(g, unit) {
  const start = hkey(unit.q, unit.r);
  const spec = TACT.units[unit.type];
  const move = spec.move;
  const onBoard = new Set(g.board.cells.map((c) => hkey(c.q, c.r)));
  // a flyer crosses obstacles and can land on them; everyone else needs open ground
  const passable = (k) => (spec.fly ? onBoard.has(k) : tacticsOpen(g, k));
  // allied pieces can be stepped THROUGH when the house rule is on (never landed
  // on); enemy pieces always block. Everyone stops on empty ground only.
  const passAllies = g.rules && g.rules.passAllies;
  const allies = new Set(),
    enemies = new Set();
  for (const id of g.order) {
    if (id === unit.id) continue;
    const u = g.units[id];
    (u.owner === unit.owner ? allies : enemies).add(hkey(u.q, u.r));
  }
  const dist = { [start]: 0 };
  const q = [start];
  while (q.length) {
    const k = q.shift();
    if (dist[k] >= move) continue;
    const { q: cq, r: cr } = unhkey(k);
    for (const [dq, dr] of HEX_DIRS) {
      const nk = hkey(cq + dq, cr + dr);
      if (dist[nk] !== undefined || !passable(nk)) continue;
      if (enemies.has(nk)) continue; // never through an enemy
      if (allies.has(nk) && !passAllies) continue; // allies block unless the rule lets you pass
      dist[nk] = dist[k] + 1;
      q.push(nk);
    }
  }
  delete dist[start];
  for (const k of allies) delete dist[k]; // a stepping-stone ally is not a landing spot
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
    // a flyer perched on an obstacle is out of melee reach — and out of the Mago's
    // blast too, since that can't target an obstacle hex. Archers/crossbows still hit it.
    if (g.board.blocked[hkey(t.q, t.r)] && (u.rng === 1 || u.aoe)) return false;
    return true;
  });
}
// Resting on your own fountain/castle to heal means no attack that turn.
const tacticsHeals = (g, seat, k) => k === g.board.castle[seat] || k === g.board.fount[seat];

// Roll 1..HP; rolling the top face (≥2) explodes and rolls again — a crit.
// `rolls` keeps each face in order so the reveal can throw them one die at a time.
function tacticsRoll(hp) {
  const face = hp;
  let total = 0,
    crit = false;
  const rolls = [];
  for (let i = 0; i < 6; i++) {
    const r = 1 + Math.floor(Math.random() * face);
    rolls.push(r);
    total += r;
    if (r === face && face >= 2) {
      crit = true;
      continue;
    }
    break;
  }
  return { total, crit, rolls };
}

function tacticsWin(g, winner, how) {
  g.done = true;
  g.matchDone = true;
  g.win = winner;
  g.how = how;
  if (winner) g.tally[winner] += 1;
}
const tacticsSquad = (g, seat) => g.order.filter((id) => g.units[id].owner === seat).length;
// A unit can act unless it's resting — but a side's lone survivor never rests.
function tacticsReady(g, id) {
  const u = g.units[id];
  if (!u) return false;
  if (tacticsSquad(g, u.owner) <= 1) return true;
  return (g.spent[id] || 0) < TACT.ACTS;
}
const tacticsHoldsAll = (g, seat) => g.board.banners.length > 0 && g.board.banners.every((k) => g.order.some((id) => g.units[id].owner === seat && hkey(g.units[id].q, g.units[id].r) === k));

// After every move: count it, wake units that have finished their one-turn rest,
// resolve a standing siege, check the win-by-flags and the move cap — then hand
// the turn to the other side (strict alternation, one move each).
function tacticsAfterMove(g, mover) {
  g.moves += 1;
  g.turns[mover] = (g.turns[mover] || 0) + 1;
  // a lone survivor never rests; a rested unit wakes once its owner has taken a turn
  for (const s of ["A", "B"]) {
    const squad = g.order.filter((id) => g.units[id].owner === s);
    if (squad.length === 1) {
      delete g.spent[squad[0]];
      delete g.rest[squad[0]];
    }
  }
  for (const id of g.order) {
    const o = g.units[id].owner;
    if ((g.spent[id] || 0) >= TACT.ACTS && g.rest[id] != null && (g.turns[o] || 0) - g.rest[id] >= 2) {
      delete g.spent[id];
      delete g.rest[id];
    }
  }
  // siege: holding the enemy keep takes it once the defender has had a move to
  // answer and the keep still stands — or, if they won't answer, after a few
  // moves regardless. Broken the moment the besieger dies or steps off.
  const s = g.siege;
  if (s) {
    const u = g.units[s.unitId];
    if (!u || hkey(u.q, u.r) !== g.board.castle[other(s.seat)]) g.siege = null;
    else {
      if (mover === other(s.seat)) s.armed = true;
      if (s.armed || g.moves - s.at >= TACT.SIEGE_STALL) {
        tacticsWin(g, s.seat, "castle");
        return;
      }
    }
  }
  // king of the hill: holding every flag at once wins the game outright
  if (g.rules.flagWin) {
    if (tacticsHoldsAll(g, "A")) return tacticsWin(g, "A", "flags");
    if (tacticsHoldsAll(g, "B")) return tacticsWin(g, "B", "flags");
  }
  // the battle ends after the move cap — decide on flags held, then total HP
  if (g.moves >= TACT.MOVE_CAP) {
    const flags = (x) => g.board.banners.filter((k) => g.order.some((id) => g.units[id].owner === x && hkey(g.units[id].q, g.units[id].r) === k)).length;
    const hp = (x) => g.order.filter((id) => g.units[id].owner === x).reduce((t, id) => t + g.units[id].hp, 0);
    const fa = flags("A"),
      fb = flags("B"),
      a = hp("A"),
      b = hp("B");
    tacticsWin(g, fa !== fb ? (fa > fb ? "A" : "B") : a === b ? null : a > b ? "A" : "B", "timeout");
    return;
  }
  g.turn = other(mover); // strict alternation, one move each
  // never a dead turn: if the side to move has units but all are resting, wake them
  const t = g.turn;
  if (g.order.some((id) => g.units[id].owner === t) && !g.order.some((id) => g.units[id].owner === t && tacticsReady(g, id))) {
    for (const id of g.order) if (g.units[id].owner === t) {
      delete g.spent[id];
      delete g.rest[id];
    }
  }
}

// One activation, resolved atomically: optionally move to `toKey`, then either
// attack a target or wait. Play strictly alternates one move each; a side that
// has run its units out gets them back, so its turn is never a dead one.
// Healing on your own castle/fountain is automatic.
function tacticsActivate(gs, seat, unitId, toKey, action) {
  if (gs.done || gs.phase !== "battle" || gs.turn !== seat) return null;
  const g = clone(gs);
  const unit = g.units[unitId];
  if (!unit || unit.owner !== seat || !tacticsReady(g, unitId)) return null;
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
    const u = TACT.units[unit.type];
    if (u.aoe) return null; // area casters aim two hexes — see the blast branch below
    const target = g.units[action.targetId];
    if (!target || target.owner === seat) return null;
    const d = hdist(unit, target);
    if (d < u.min || d > u.rng || (u.rng > 1 && !tacticsLoS(g, unit, target))) return null;
    if (u.rng === 1 && g.board.blocked[hkey(target.q, target.r)]) return null; // can't reach a flyer perched on an obstacle
    const res = tacticsRoll(unit.hp);
    const bonus = g.rules.flagAtk && g.board.banners.includes(uk) ? TACT.FLAG_DMG : 0; // +1 attacking from a flag
    const dmg = res.total + bonus;
    target.hp -= dmg;
    const killed = target.hp <= 0;
    if (killed) {
      delete g.units[action.targetId];
      g.order = g.order.filter((id) => id !== action.targetId);
    }
    roll = { attacker: unitId, target: action.targetId, atkType: unit.type, tgtType: target.type, dmg, crit: res.crit, killed, rolls: res.rolls, bonus, die: unit.hp };
    ev = { t: "attack", unit: unit.type, target: target.type, dmg, crit: res.crit, killed, splash: 0 };
    kind = res.crit ? "scopa" : "take"; // a crit gets the big slam + shake
  } else if (action && action.kind === "blast") {
    // area caster: it aims a first hex (in range, in sight, not an obstacle) plus
    // one adjacent second hex, and the same roll lands on every unit standing in
    // those two hexes — friend or foe. The caster is out at range, so it's never
    // caught in its own blast.
    if (tacticsHeals(g, seat, uk)) return null;
    const u = TACT.units[unit.type];
    if (!u.aoe) return null;
    const [k1, k2] = action.cells || [];
    if (!k1 || !k2 || k1 === k2) return null;
    if (g.board.blocked[k1] || g.board.blocked[k2]) return null; // neither hex can be an obstacle
    const c1 = unhkey(k1),
      c2 = unhkey(k2);
    const d1 = hdist(unit, c1);
    if (d1 < u.min || d1 > u.rng) return null; // the aimed hex is within range
    if (u.rng > 1 && !tacticsLoS(g, unit, c1)) return null; // and in line of sight
    if (hdist(c1, c2) !== 1) return null; // the second hex borders the first
    const area = new Set([k1, k2]);
    const hits = g.order.filter((id) => id !== unitId && area.has(hkey(g.units[id].q, g.units[id].r)));
    if (!hits.length) return null; // the blast has to catch at least one unit
    const res = tacticsRoll(unit.hp);
    const bonus = g.rules.flagAtk && g.board.banners.includes(uk) ? TACT.FLAG_DMG : 0;
    const dmg = res.total + bonus;
    let killed = 0,
      tgtType = null;
    for (const id of hits) {
      const o = g.units[id];
      if (!tgtType || o.owner !== seat) tgtType = o.type; // prefer an enemy as the reveal label
      o.hp -= dmg;
      if (o.hp <= 0) {
        delete g.units[id];
        g.order = g.order.filter((x) => x !== id);
        killed += 1;
      }
    }
    roll = { attacker: unitId, atkType: unit.type, tgtType, dmg, crit: res.crit, killed: killed > 0, rolls: res.rolls, bonus, die: unit.hp, blast: true };
    ev = { t: "attack", unit: unit.type, target: tgtType, dmg, crit: res.crit, killed: killed > 0, splash: Math.max(0, hits.length - 1) };
    kind = res.crit ? "scopa" : "take";
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
    else if (g.rules.flagHeal && g.board.banners.includes(uk)) unit.hp = Math.min(unit.max, unit.hp + 2); // flags mend (house rule)
  }
  g.last = { ...(roll || {}), unitId, to: uk };
  // holding the enemy castle doesn't win on contact: plant the siege and let it
  // ride out the opponent's retaliation (the capture lands in tacticsAfterMove).
  if (alive && uk === foeCastle) {
    if (!g.siege || g.siege.unitId !== unitId) g.siege = { seat, unitId, at: g.moves, armed: false };
  } else if (g.siege && g.siege.unitId === unitId) {
    g.siege = null; // this unit is the besieger no longer
  }
  if (!g.order.some((id) => g.units[id].owner === "A")) tacticsWin(g, "B", "wipe");
  else if (!g.order.some((id) => g.units[id].owner === "B")) tacticsWin(g, "A", "wipe");
  if (!g.done) {
    // a unit that's still alive spends a move; on its last move it starts resting
    // (a lone survivor is exempt — tracked in tacticsAfterMove, which also wakes)
    if (g.units[unitId] && tacticsSquad(g, seat) > 1) {
      g.spent[unitId] = (g.spent[unitId] || 0) + 1;
      if (g.spent[unitId] >= TACT.ACTS) g.rest[unitId] = g.turns[seat] || 0;
    }
    tacticsAfterMove(g, seat);
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
// The game to open a fresh table on: the one played most across the local
// head-to-head history, or a random one when there's no history yet.
function mostPlayedGame(board) {
  const tally = {};
  for (const pk in board || {}) {
    const bg = (board[pk] && board[pk].byGame) || {};
    for (const g in bg) {
      if (!GAMES[g]) continue;
      let n = 0;
      for (const w in bg[g]) n += bg[g][w] || 0;
      tally[g] = (tally[g] || 0) + n;
    }
  }
  const played = Object.keys(tally);
  if (!played.length) {
    const all = Object.keys(GAMES);
    return all[Math.floor(Math.random() * all.length)];
  }
  return played.reduce((best, g) => (tally[g] > tally[best] ? g : best), played[0]);
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

/* ═══════════════════════════ marks ═══════════════════════════ */
/* Card face is a per-device choice, not a table rule: each player sees the deck
   they picked. false → Napoletane (Italian suits, A/F/C/R); true → Francesi
   (French suits ♦♥♠♣, A/J/Q/K). Values and scoring never change. */
const SuitCtx = createContext(false);
const FR_SUIT = { D: { g: "♦", c: "#B23A2E" }, C: { g: "♥", c: "#B23A2E" }, S: { g: "♠", c: "#15181C" }, B: { g: "♣", c: "#15181C" } };
const FR_RANK = { 1: "A", 8: "J", 9: "Q", 10: "K" };
const FR_SUIT_NAME = { D: "quadri", C: "cuori", S: "picche", B: "fiori" };
const EN_SUIT_NAME = { D: "diamonds", C: "hearts", S: "spades", B: "clubs" };
// Napoletane suits keep their Italian names (proper terms of the deck); English
// only kicks in for the French deck's four familiar suits.
const VS_TEXT = String.fromCharCode(0xfe0e); // force text (not emoji) rendering of ♦♥♠♣
const faceLbl = (v, french) => (french ? FR_RANK[v] || String(v) : lbl(v));
const suitName = (s, french) => (french ? (LANG === "en" ? EN_SUIT_NAME[s] : FR_SUIT_NAME[s]) : SUIT[s].name.toLowerCase());

// Render a move event into a sentence using the READER's deck, so the log always
// matches the card names that reader sees (Napoletane A/F/C/R vs Francesi A/J/Q/K).
function describe(ev, french) {
  if (!ev) return "";
  const r = (v) => faceLbl(v, french);
  // a card {s,v} → "3♠" (rank + the suit glyph the reader sees on the cards:
  // ♦♥♠♣ on Francesi, the little pip on Napoletane). Bare ranks fall through.
  const tag = (c, key) => {
    if (!c || typeof c !== "object") return <span key={key}>{r(c)}</span>;
    return (
      <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 0, verticalAlign: "-0.28em", whiteSpace: "nowrap", fontWeight: 700 }}>
        {r(c.v)}
        {c.s ? <Pip suit={c.s} size={16} /> : null}
      </span>
    );
  };
  const list = (cards) => (cards || []).flatMap((c, i) => (i ? [<span key={`p${i}`}> + </span>, tag(c, `c${i}`)] : [tag(c, `c${i}`)]));
  const self = { s: ev.s, v: ev.v };
  switch (ev.t) {
    case "lay":
      return <>{L("cala","lays")} {tag(self)}</>;
    case "take":
      return <>{L("prende","takes")} {list(ev.got)} {L("con","with")} {tag(self)}</>;
    case "scopa":
      return ev.card ? <>{L("scopa! prende","scopa! takes")} {list(ev.got)} {L("con","with")} {tag(ev.card)}</> : L("svuota il tavolo — scopa","clears the table — scopa");
    case "bank":
      return L("incassa l’asso","banks the ace");
    case "steal":
      return <>{L("ruba un mazzo di","steals a pile of")} {ev.n} {L("con","with")} {tag(self)}</>;
    case "rtake":
      return <>{L("prende","takes")} {ev.n} {L("con","with")} {tag(self)}</>;
    case "turn":
      return <>{L("gira","flips")} {tag(self)}</>;
    case "attack":
      return (
        <>
          {L("gira","flips")} {tag(self)} — {ev.d} {L("da pagare","to pay")}
        </>
      );
    case "pay":
      return `${L("paga l’ultima —","pays the last —")} ${ev.n} ${L("carte cambiano mano","cards change hands")}`;
    case "blead":
      return <>{L("apre con","leads")} {tag(self)}</>;
    case "btake":
      return <>{L("risponde con","responds")} {tag(self)}</>;
    case "pdraw":
      return <>{L("pesca — tiene","draws — keeps")} {tag(self)}</>;
    case "ppair":
      return <>{L("pesca","draws")} {tag(self)} {L("e scarta la coppia","and discards the pair")}</>;
    case "pshuffle":
      return L("rimescola la mano","reshuffles the hand");
    case "parrange":
      return L("sistema le carte","arranges the cards");
    case "poffer":
      return L("offre una carta","offers a card");
    case "pready":
      return L("presenta la mano","presents the hand");
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
      fontFamily: MONO,
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
function Button({ children, onClick, disabled, soft, kind = "solid", full, tone }) {
  const solid = kind === "solid";
  const muted = disabled || soft;
  const ink = tone || T.ink; // a side can tint its own controls (Condottieri: blue vs red)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: full ? "100%" : "auto",
        background: muted ? "transparent" : solid ? ink : "transparent",
        color: muted ? T.ink30 : solid ? T.bg : ink,
        border: `1.5px solid ${muted ? T.line : ink}`,
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
    compass: (
      <>
        <circle {...P} cx="12" cy="12" r="9" />
        <path {...P} d="M15.5 8.5 13 13l-4.5 2.5L11 11z" />
        {dot(12, 12)}
      </>
    ),
    eagle: (
      <>
        <path {...P} d="M12 8.5 9.7 5.4C7 6 5 7.4 3.6 9.8c2-.6 3.6-.4 5 .5-.4 1-.4 2 .1 3 1.1-1.4 2.3-2.2 3.7-2.4" />
        <path {...P} d="M12 8.5 14.3 5.4C17 6 19 7.4 20.4 9.8c-2-.6-3.6-.4-5 .5.4 1 .4 2-.1 3-1.1-1.4-2.3-2.2-3.7-2.4" />
        <path {...P} d="M12 8.5v8M10.2 18.4 12 16.5l1.8 1.9" />
      </>
    ),
    crossbow: (
      <>
        <path {...P} d="M4 8c2.3-2 4.9-3 8-3s5.7 1 8 3" />
        <path {...P} d="M6 6.2v3.4M18 6.2v3.4" />
        <path {...P} d="M12 4.5V20M9 20h6" />
      </>
    ),
    sling: (
      <>
        <path {...P} d="M4 4c2.8 6 5.3 8.8 8 9" />
        <path {...P} d="M20 4c-2 4.3-3.4 6.6-5.4 8" />
        <circle {...P} cx="12.4" cy="16.4" r="3" />
      </>
    ),
    flag: (
      <>
        <path {...P} d="M6 21V4" />
        <path {...P} d="M6 4.5h11l-2.6 3.5L17 11.5H6" />
      </>
    ),
    spark: (
      <>
        <path {...P} d="M12 2.5l1.9 6.6 6.6 1.9-6.6 1.9L12 19.5l-1.9-6.6L3.5 11l6.6-1.9z" />
        <path {...P} d="M18.5 3.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
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
        if (res && res.outcome === "accepted") setNote(L("Fatto! La trovi nella schermata Home.", "Done! You’ll find it on your Home screen."));
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
      LANG === "en" ? (
        <>
          You’re opening the game <b>inside another app</b> (WhatsApp, Instagram…), which can’t install it.
          Tap <b>⋮</b> at the top and choose <b>“Open in Chrome”</b>, then <b>“Install app”</b> from there.
        </>
      ) : (
        <>
          Stai aprendo il gioco <b>dentro un’altra app</b> (WhatsApp, Instagram…), che non può installare.
          Tocca <b>⋮</b> in alto e scegli <b>“Apri in Chrome”</b>, poi da lì <b>“Installa app”</b>.
        </>
      )
    ) : inApp && isIOS ? (
      LANG === "en" ? (
        <>
          You’re opening the game <b>inside another app</b>. Tap <b>⋯</b> and choose <b>“Open in Safari”</b>,
          then <b>Share → “Add to Home Screen”</b>.
        </>
      ) : (
        <>
          Stai aprendo il gioco <b>dentro un’altra app</b>. Tocca <b>⋯</b> e scegli <b>“Apri in Safari”</b>,
          poi <b>Condividi → “Aggiungi a Home”</b>.
        </>
      )
    ) : isIOS ? (
      iosSafari ? (
        LANG === "en" ? (
          <>
            Tap <b>Share</b> <Ico n="share" s={14} style={{ verticalAlign: "-0.2em" }} /> at the bottom, then <b>“Add to Home Screen”</b>.
          </>
        ) : (
          <>
            Tocca <b>Condividi</b> <Ico n="share" s={14} style={{ verticalAlign: "-0.2em" }} /> in basso, poi <b>“Aggiungi a Home”</b>.
          </>
        )
      ) : LANG === "en" ? (
        <>
          Open this page in <b>Safari</b>, then <b>Share → “Add to Home Screen”</b>.
        </>
      ) : (
        <>
          Apri questa pagina in <b>Safari</b>, poi <b>Condividi → “Aggiungi a Home”</b>.
        </>
      )
    ) : samsung ? (
      LANG === "en" ? (
        <>
          Open the browser’s <b>≡</b> menu, then <b>“Add page to” → “Home screen”</b>.
        </>
      ) : (
        <>
          Apri il menu <b>≡</b> del browser, poi <b>“Aggiungi pagina a” → “Schermata Home”</b>.
        </>
      )
    ) : LANG === "en" ? (
      <>
        Open the browser’s <b>⋮</b> menu, then <b>“Install app”</b> (or <b>“Add to Home screen”</b>).
      </>
    ) : (
      <>
        Apri il menu <b>⋮</b> del browser, poi <b>“Installa app”</b> (o <b>“Aggiungi a schermata Home”</b>).
      </>
    );

  const link = { ...plain, display: "flex", width: "fit-content", alignItems: "center", gap: 6, margin: "14px auto 0", textAlign: "center", color: T.ink, fontWeight: 600 };
  const label = inApp && isAndroid ? L("Apri in Chrome per installare","Open in Chrome to install") : L("Installa l’app","Install the app");
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
// A big shaking "Scopa!" across the middle of the table when someone clears it.
// A capture reveal on the scopa board: the cards a play swept — the table cards
// it took, then the card from hand (ringed) — held centre-screen for a beat so
// you can read exactly what was played, then flown off toward the taker's pile.
// On a sweep it also flashes "Scopa!". Both screens show it from the shared anim.
const CAP_FLY = 640; // ms of the fly-to-pile animation (matches flypR/flypL)
function CaptureReveal({ room, seat }) {
  const [shot, setShot] = useState(null);
  const [phase, setPhase] = useState("hold"); // hold → fly
  const seen = useRef(null);
  useEffect(() => {
    const a = room?.anim;
    const ev = room?.ev;
    if (!a || a.id === seen.current) return;
    seen.current = a.id;
    // a scopa carries the played card in ev.card; a plain take carries it in
    // ev.s/ev.v — either way, reveal the captured cards plus the card from hand
    const played = ev && (ev.t === "scopa" ? ev.card : ev.s != null ? { s: ev.s, v: ev.v } : null);
    if (ev && (ev.t === "take" || ev.t === "scopa") && played) {
      setShot({ id: a.id, by: a.seat, scopa: ev.t === "scopa", card: played, got: ev.got || [] });
    }
  }, [room?.anim?.id]);
  useEffect(() => {
    if (!shot) return;
    setPhase("hold");
    // hold the presa long enough to read — longer when more cards are swept
    const hold = 1300 + (shot.got.length + 1) * 260;
    const t1 = setTimeout(() => setPhase("fly"), hold);
    const t2 = setTimeout(() => setShot(null), hold + CAP_FLY);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [shot && shot.id]);
  if (!shot) return null;
  const flyCls = shot.by === seat ? "flypR" : "flypL"; // toward the taker's pile (mine right, theirs left)
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, pointerEvents: "none", padding: 20 }}>
      {shot.scopa && (
        <div
          key={`t${shot.id}`}
          className="scopaflash"
          style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(56px, 20vw, 132px)", color: "#A5342F", letterSpacing: "-0.03em", textShadow: "0 6px 0 rgba(18,18,18,0.10)", whiteSpace: "nowrap", lineHeight: 1 }}
        >
          Scopa<span style={{ color: T.ink }}>!</span>
        </div>
      )}
      <div
        key={`c${shot.id}-${phase}`}
        className={phase === "fly" ? flyCls : "pop"}
        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 360, padding: "12px 14px", background: "rgba(247,246,243,0.96)", border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: "0 14px 34px rgba(18,18,18,0.22)" }}
      >
        {shot.got.map((c, i) => (
          <Card key={`g${i}`} card={c} size="sm" rot={0} />
        ))}
        {shot.got.length > 0 && <Ico n="plus" s={16} c={T.ink30} />}
        <div style={{ borderRadius: 8, outline: "2px solid #A5342F", outlineOffset: 2 }}>
          <Card card={shot.card} size="sm" rot={0} />
        </div>
      </div>
    </div>
  );
}

// The scopas a player has swept this hand — always shown (independent of the
// show-points toggle), since a scopa is a public event you want to keep count of.
function ScopeTag({ n, cards }) {
  const french = useContext(SuitCtx);
  if (!n) return null;
  // the card that made each sweep — stored last in every scopeCards entry
  const takers = (cards || []).map((set) => (set && set.length ? set[set.length - 1] : null)).filter(Boolean);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: "rgba(165,52,47,0.12)",
        color: "#A5342F",
        border: "1px solid rgba(165,52,47,0.34)",
        borderRadius: 999,
        padding: "1px 8px",
        fontFamily: BRAND,
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {n} scopa
      {takers.map((c, i) => (
        <span key={i} title={L("la carta che ha fatto scopa","the card that scored the scopa")} style={{ display: "inline-flex", alignItems: "center", gap: 0, fontWeight: 700, fontSize: 12, borderLeft: i === 0 ? "1px solid rgba(165,52,47,0.34)" : "none", paddingLeft: i === 0 ? 5 : 0 }}>
          {faceLbl(c.v, french)}
          <Pip suit={c.s} size={13} />
        </span>
      ))}
    </span>
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
      <Micro style={{ textAlign: "center" }}>{L("Testa a testa", "Head to head")}</Micro>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 6 }}>
        <div style={nameStyle("right")}>{nA}</div>
        {big(wA, wA > wB)}
        <span style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 24, color: T.ink30 }}>–</span>
        {big(wB, wB > wA)}
        <div style={nameStyle("left")}>{nB}</div>
      </div>
      {games.length ? (
        <div style={{ marginTop: 10 }}>
          <Accordion label={L("Per gioco", "By game")}>
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
        <Micro style={{ textAlign: "center", marginTop: 8 }}>{L("prima sfida — che vinca il migliore", "first match — may the best win")}</Micro>
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
      <Ico n="flask" s={14} /> {L("Solo · sei", "Solo · you are")} {names[seat] || seat} — {L("tocca per passare all’altro", "tap to switch sides")}
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
          {L("Chiudi", "Close")}
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
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.55, margin: "8px 0 18px" }}>{L("Avvicinate i telefoni e toccate Bump insieme.", "Bring your phones close and tap Bump together.")}</p>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
          <span className="recdot" style={{ animationDelay: "0ms" }} />
          <span className="recdot" style={{ animationDelay: "140ms" }} />
          <span className="recdot" style={{ animationDelay: "280ms" }} />
        </div>
        <Button kind="line" onClick={onCancel}>
          {L("Annulla", "Cancel")}
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
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: T.ink, marginTop: 8 }}>{L("Già ti alzi dal tavolo?", "Leaving the table already?")}</div>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.55, margin: "8px 0 20px" }}>
          {L("La mano è ancora calda e il tuo posto è caldo pure lui. Se esci lasci le carte all’oste — e l’oste bara.", "The hand's still warm, and so is your seat. Leave and you hand your cards to the innkeeper — and the innkeeper cheats.")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Button full onClick={onStay}>
            {L("Resto a giocare", "Stay and play")}
          </Button>
          <button onClick={onGo} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
            {L("Esco lo stesso", "Leave anyway")}
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
  const nextLabel = scopaLike(room.game) && !gs.matchDone ? L("Prossima mano", "Next hand") : L("Gioca ancora", "Play again");
  const win = outcome === "win";
  const draw = outcome === "draw";
  const head = !decided ? L("Punteggio", "Score") : win ? L("Vittoria!", "You win!") : draw ? L("Pareggio", "Draw") : L("Sconfitta", "You lose");
  const color = !decided ? T.ink : win ? "#B8862B" : draw ? T.ink60 : "#A5342F";
  const sub = !decided ? null : win ? L("Offre l’oste", "Drinks on the house") : draw ? L("Pari e patta — nessuno paga", "All square — nobody pays") : L("Ci sta una rivincita.", "There's always a rematch.");
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
            <Micro style={{ textAlign: "center" }}>{room.names.A} {L("distribuisce", "is dealing")}…</Micro>
          )}
          <button onClick={onExit} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
            {L("Torna ai giochi", "Back to games")}
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
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 20, color: T.ink }}>{L("Aspetto", "Waiting for")} {who(room, other(seat))}…</div>
            <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px 0 16px" }}>{L("Hai chiesto di chiudere la partita. Deve dire di sì anche l’altro.", "You asked to end the game. The other player has to agree too.")}</p>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 18 }}>
              <span className="recdot" style={{ animationDelay: "0ms" }} />
              <span className="recdot" style={{ animationDelay: "140ms" }} />
              <span className="recdot" style={{ animationDelay: "280ms" }} />
            </div>
            <Button kind="line" full onClick={onCancel}>
              {L("Annulla", "Cancel")}
            </Button>
          </>
        ) : (
          <>
            <div><Ico n="exit" s={30} c={T.ink} sw={1.6} /></div>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 21, color: T.ink, marginTop: 6 }}>{who(room, req.by)} {L("vuole smettere", "wants to stop")}</div>
            <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px 0 18px" }}>{L("Chiudete qui e tornate a scegliere un gioco?", "End here and go back to pick a game?")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Button full onClick={onAgree}>
                {L("Sì, ai giochi", "Yes, to the games")}
              </Button>
              <button onClick={onDecline} style={{ ...plain, color: T.ink60, fontSize: 14, padding: "6px 0" }}>
                {L("No, continuiamo", "No, keep playing")}
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
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 20, color: T.ink }}>{L("Riconnessione…", "Reconnecting…")}</div>
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
.deck3d{perspective:1600px}
.deckcard{position:relative;transform-style:preserve-3d;transition:transform 560ms cubic-bezier(.2,.8,.2,1)}
.deckcard.flip{transform:rotateY(180deg)}
.deckface{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
@keyframes bristuck{from{transform:translate(-50%,-50%) scale(1) rotate(0);opacity:1}to{transform:translate(-190%,-28%) scale(.34) rotate(90deg);opacity:0}}
.bristuck{animation:bristuck 640ms cubic-bezier(.4,0,.2,1) forwards}
.deckback{transform:rotateY(180deg)}
@media (prefers-reduced-motion:reduce){.slam,.jolt,.fade,.deal,.turn,.swap,.pop,.confetti,.flipy,.floaty,.dieroll,.recdot,.deckbob,.scopaflash,.flypR,.flypL,.tumble,.settle,.critshake,.hexpulse,.bristuck{animation:none!important}.deckcard{transition:none}}
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
  const [lang, setLang] = useState(systemLang); // "it" | "en" — default follows the phone
  LANG = lang; // set before children render, so every L() reads the current language
  const booted = useRef(false);
  useEffect(() => {
    (async () => {
      const p = await loadPrefs();
      if (!p) return;
      if (typeof p.french === "boolean") setFrench(p.french);
      if (p.rules && typeof p.rules === "object") setSavedRules(p.rules);
      if (typeof p.name === "string") setName(p.name);
      if (typeof p.showScores === "boolean") setShowScores(p.showScores);
      if (p.lang === "it" || p.lang === "en") setLang(p.lang);
    })();
  }, []);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    savePrefs({ french, rules: savedRules, name, showScores, lang });
  }, [french, savedRules, name, showScores, lang]);
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
        lang={lang}
        setLang={setLang}
      />
    </SuitCtx.Provider>
  );
}

function Game({ french, setFrench, savedRules, setGameRules, name, setName, showScores, setShowScores, lang, setLang }) {
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
  const [reconnecting, setReconnecting] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [bumping, setBumping] = useState(false); // waiting in the bump lobby
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
    // Higher version wins. Turn-free Condottieri means two moves can land on the
    // same version at once; break that tie by timestamp so both devices converge
    // on the later write (one move is dropped, but the state never diverges).
    if (cur && (r.v < cur.v || (r.v === cur.v && (r.ts || 0) <= (cur.ts || 0)))) return;
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

  /* ── swallow the browser Back button while at a table ── a stray back would
     drop the game with no way back in. Trap it and offer the explicit leave. ── */
  useEffect(() => {
    if (screen !== "table") return;
    let armed = true;
    try {
      history.pushState({ osteria: true }, "");
    } catch {}
    const onPop = () => {
      if (!armed) return;
      try {
        history.pushState({ osteria: true }, "");
      } catch {}
      setAskLeave(true);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      armed = false;
      window.removeEventListener("popstate", onPop);
    };
  }, [screen]);

  /* ── animation trigger, local and remote ── */
  useEffect(() => {
    const a = room?.anim;
    if (!a || a.id === seenAnim.current) return;
    seenAnim.current = a.id;
    setSlamId(a.card || null);
    if (!a.nojolt) setJolt(true);
    slamSound(a.kind, soundRef.current);
    buzz(a.kind);
    const timers = [setTimeout(() => setJolt(false), 200), setTimeout(() => setSlamId(null), 460)];
    // The "Scopa!" flash and the held card reveal are owned by the board itself
    // (CaptureReveal), so a capture shows exactly which cards it swept.
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
          setMsg(L("Nessun tavolo risponde a questo codice.","No table answered that code."));
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
    const g0 = mostPlayedGame(boardRef.current); // open on your most-played game (or a random one)
    const fresh = {
      code,
      v: 0,
      ts: Date.now(),
      names: { A: name.trim() || "Oste", B: null },
      status: "lobby",
      game: g0,
      opts: { ...GAMES[g0].def, ...(savedRules[g0] || {}) },
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
    const g0 = mostPlayedGame(boardRef.current);
    const fresh = {
      code,
      v: 0,
      ts: Date.now(),
      names: { A: name.trim() || "Uno", B: "Due" },
      status: "lobby",
      game: g0,
      opts: { ...GAMES[g0].def, ...(savedRules[g0] || {}) },
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
    if (code.length !== 4) return setMsg(L("Il codice è di quattro lettere.","The code is four letters."));
    setSeat("B");
    setLink("waiting");
    if (hasStore()) {
      const r = await storeRead(code);
      if (!r) return setMsg(`${L("Nessun tavolo al codice","No table at code")} ${code}.`);
      roomRef.current = r;
      setRoom(r);
      openStorage(code);
      await netRef.current.hello(name.trim() || "Ospite");
    } else if (await openRelay(code, false, name.trim() || "Ospite")) {
      setTimeout(() => {
        if (!roomRef.current) {
          netRef.current?.close();
          setMsg(`${L("Nessun tavolo al codice","No table at code")} ${code}.`);
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
      if (navigator.share) return await navigator.share({ title: "Osteria!", text: L("Gioca a Osteria con me", "Play Osteria with me"), url });
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg(L("Link copiato", "Link copied"));
    } catch {
      setMsg(url);
    }
  };
  // Bump: both phones tap Bump; the lobby pairs them into a fresh table.
  const bump = (graceMs = 3200) => {
    if (hasStore()) return setMsg(L("Il bump funziona solo online.", "Bump works online only."));
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
        return setMsg(L("Bump non disponibile.", "Bump unavailable."));
      }
      bumpRef.current = ws;
      const timer = setTimeout(() => {
        if (bumpRef.current === ws) {
          try {
            ws.close();
          } catch {}
          bumpRef.current = null;
          setBumping(false);
          setMsg(L("Nessuno vicino ha bumpato. Riprova insieme.", "Nobody nearby bumped. Try again together."));
        }
      }, graceMs);
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
        setMsg(L("Bump non disponibile.", "Bump unavailable."));
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
      if (e.touches[0].clientY - y <= 0) return; // only a DOWNWARD drag can pull-to-refresh
      // let an inner scroller (a card back's rules list) consume the upward scroll first
      for (let n = e.target; n && n !== document.body; n = n.parentElement) {
        if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) {
          const oy = getComputedStyle(n).overflowY;
          if (oy === "auto" || oy === "scroll") return;
        }
      }
      const el = document.scrollingElement || document.documentElement;
      if (el.scrollTop <= 0) e.preventDefault();
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
      // `nojolt` moves still thwack + buzz but skip the screen jolt — the jolt
      // transforms the whole frame, which would drag any fixed overlay (e.g. the
      // Yahtzee opponent-scorecard peek) along with it.
      anim: res.quiet ? null : { id: uid(), kind: res.kind, card: res.card?.id, seat, nojolt: res.nojolt },
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
      : game === "diecimila"
      ? dealFarkle(dealer, cont?.tally || null, o)
      : game === "scala"
      ? dealScala(dealer, cont?.tally || null, deck)
      : game === "peppa"
      ? dealPeppa(dealer, cont?.tally || null)
      : game === "condottieri"
      ? dealTactics(dealer, o, cont?.tally || null)
      : game === "bestiario"
      ? dealBestiario(dealer, cont?.tally || null)
      : dealCamicia(cont?.tally || null, deck);

  const dealNow = (gsNew) => publish({ ...room, status: "play", gs: gsNew, log: [], ev: null, anim: null });

  // Enter the shuffle-and-cut ritual with a fresh RNG deck; the dealer shuffles,
  // the other player cuts, then the cut hand deals from the result.
  const beginPrepare = (dealer, cont) =>
    publish({ ...room, status: "prep", prep: { deck: ritualDeck(room.game), step: "shuffle", shuffles: 0, dealer, cont: cont || null } });

  const shuffleTap = (seed) =>
    publish({ ...room, prep: { ...room.prep, deck: shuffleWith(room.prep.deck, seed), shuffles: room.prep.shuffles + 1 } });
  const shuffleDone = () => publish({ ...room, prep: { ...room.prep, step: "cut" } });
  // broadcast the cutter's live position so the dealer watches the cut in real time
  const liveCut = (at) => {
    if (!room.prep || room.prep.step !== "cut" || room.prep.cutAt === at) return;
    publish({ ...room, prep: { ...room.prep, cutAt: at } });
  };
  const cutAndDeal = (at) => {
    const p = room.prep;
    const gsNew = dealGame(room.game, room.opts, p.dealer, p.cont, cutDeck(p.deck, at));
    publish({ ...room, status: "play", gs: gsNew, prep: null, log: [], ev: null, anim: null });
  };

  const start = () => (usesShuffle(room.game) ? beginPrepare("A", null) : dealNow(dealGame(room.game, room.opts, "A", null)));
  const again = () => {
    const g = room.gs;
    // Scopa runs the shuffle-and-cut ritual before every hand — mid-match the
    // dealer alternates and the running scores carry over; a finished match
    // starts fresh from seat A.
    if (scopaLike(room.game)) beginPrepare(g.matchDone ? "A" : other(g.dealer), g.matchDone ? null : { scores: g.scores });
    else if (usesShuffle(room.game)) beginPrepare(other(g.dealer), { tally: g.tally }); // ruba, camicia, briscola, scala
    else if (GAMES[room.game].instant) dealNow(dealGame(room.game, room.opts, other(g.dealer), { tally: g.tally })); // peppa
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
          <Micro style={{ marginTop: 16 }}>{L("Distribuzione…", "Dealing…")}</Micro>
        </div>
      </Frame>
    );

  /* ═════════ home ═════════ */
  if (screen === "home")
    return (
      <Frame jolt={false}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <LangPill lang={lang} setLang={setLang} />
        </div>
        <div
          className="fade"
          style={{
            minHeight: "calc(100dvh - 80px)",
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
              fontSize: "clamp(44px, 15vw, 82px)",
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: "-0.01em",
              textAlign: "center",
              margin: "6px 0 0",
              whiteSpace: "nowrap",
            }}
          >
            Osteria<span style={{ color: "#A5342F", display: "inline-block", transform: "rotate(7deg)" }}>!</span>
          </h1>
          <Micro style={{ textAlign: "center", marginTop: 6 }}>{L("Due giocatori · due telefoni · un codice", "Two players · two phones · one code")}</Micro>

          <div style={{ marginTop: 18 }}>
            <input
              value={name}
              onChange={(e) => {
                typedName.current = true;
                setName(e.target.value);
              }}
              placeholder={L("Il tuo nome", "Your name")}
              maxLength={14}
              style={{ ...field, fontFamily: BRAND, fontSize: 18, textAlign: "center", padding: "14px 13px" }}
            />
            <div style={{ marginTop: 10 }}>
              <Button full onClick={() => openTable()}>
                {L("Apri un tavolo", "Open a table")}
              </Button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 2px" }}>
              <div style={{ flex: 1, height: 1, background: T.line }} />
              <Micro>{L("oppure", "or")}</Micro>
              <div style={{ flex: 1, height: 1, background: T.line }} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={codeIn}
                onChange={(e) => setCodeIn(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                placeholder={L("CODICE", "CODE")}
                style={{ ...field, textAlign: "center", letterSpacing: "0.4em", fontFamily: MONO, fontSize: 18, minWidth: 0 }}
              />
              <Button kind="line" onClick={() => joinTable()}>
                {L("Entra", "Join")}
              </Button>
            </div>

            {/* quick-pair: both phones tap Bump together and the lobby pairs them */}
            {!hasStore() && (
              <div style={{ marginTop: 14 }}>
                <button onClick={() => bump()} style={{ ...plain, cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: `1.5px solid ${T.ink}`, borderRadius: 12, padding: "12px 14px", fontFamily: BRAND, fontWeight: 700, fontSize: 16, color: T.ink, WebkitTapHighlightColor: "transparent" }}>
                  <Ico n="bump" s={20} /> {L("Bump — avvicina i telefoni", "Bump — tap phones together")}
                </button>
              </div>
            )}

            {/* Testing only: hidden behind the ?solo (or ?test) link, so ordinary
                visitors never see it. Opens a local two-seat table you drive from
                one device, flipping sides with the toggle up top. */}
            {soloRef.current && (
              <button
                onClick={openSolo}
                style={{ ...plain, display: "flex", width: "fit-content", alignItems: "center", gap: 6, margin: "16px auto 0", color: T.ink, fontWeight: 600, fontSize: 13.5 }}
              >
                <Ico n="flask" s={15} /> {L("Prova da solo", "Play solo")} <span style={{ color: T.ink30, fontWeight: 400 }}>{L("· due lati, un telefono", "· both sides, one phone")}</span>
              </button>
            )}
            {msg && <p style={{ color: T.ink, fontSize: 13, marginTop: 12, textAlign: "center" }}>{msg}</p>}
            {!hasStore() && <InstallPrompt />}
          </div>
        </div>
        <BumpVeil show={bumping} onCancel={cancelBump} />
      </Frame>
    );

  if (!room)
    return (
      <Frame jolt={false}>
        <div className="fade" style={{ paddingTop: 60, textAlign: "center" }}>
          <Micro>{L("Connessione a", "Connecting to")} {codeIn.toUpperCase()}</Micro>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 18 }}>
            <Back size="sm" />
            <Back size="sm" />
          </div>
          <div style={{ marginTop: 24 }}>
            <Button kind="line" onClick={leave}>
              {L("Indietro", "Back")}
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
    const gkeys = Object.keys(GAMES);
    const gIndex = Math.max(0, gkeys.indexOf(room.game));
    const frontFace = (key, isMid) => {
      const gm = GAMES[key];
      return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "14px 18px", gap: 8 }}>
          <GameArt game={key} size={72} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(22px, 6vw, 30px)", letterSpacing: "-0.02em", lineHeight: 1.02 }}>{gm.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: T.ink30 }}>{gtag(gm)}</div>
          </div>
          <p style={{ color: T.ink60, fontSize: 12, lineHeight: 1.45, margin: 0, maxWidth: 260, overflow: "hidden" }}>{gline(gm)}</p>
          {isMid && <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: T.ink30 }}>{L("Tocca per le regole", "Tap for the rules")} ↻</div>}
        </div>
      );
    };
    const backFace = (key) => {
      const gm = GAMES[key];
      return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "18px 18px 16px" }}>
          <div style={{ paddingRight: 40 }}>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 19 }}>{gm.name}</div>
            <Micro style={{ marginTop: 3 }}>{L("Regole della casa", "House rules")}</Micro>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", marginTop: 12, paddingRight: 2 }}>
            {gm.opts.length > 0 ? (
              <RuleChips conf={gm} opts={room.opts} setOpt={host ? setOpt : null} />
            ) : (
              <Micro style={{ textTransform: "none", letterSpacing: 0, fontSize: 12.5, lineHeight: 1.5 }}>{L("Nessuna regola da scegliere per questo gioco.", "No rules to set for this game.")}</Micro>
            )}
            {usesRitual(key) && (
              <>
                <Micro style={{ marginTop: 18 }}>{L("Punti e prese", "Points & captures")}{host ? "" : L(" · li decide l’host", " · host decides")}</Micro>
                <Segmented
                  options={[
                    { v: false, label: L("Nascondi", "Hide") },
                    { v: true, label: L("Mostra", "Show") },
                  ]}
                  value={!!room.scores}
                  onPick={host ? setScores : null}
                  style={{ marginTop: 8 }}
                />
                <Micro style={{ marginTop: 18 }}>{L("Carte · sul tuo telefono", "Cards · on your phone")}</Micro>
                <FaceToggle french={french} setFrench={setFrench} />
              </>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            {host ? (
              <Button full disabled={!seated} onClick={start}>
                {seated ? `${L("Distribuisci", "Deal")} · ${gm.name}` : L("Aspetta il 2º giocatore…", "Waiting for player 2…")}
              </Button>
            ) : (
              <Micro>{room.names.A} {L("sta preparando il tavolo — un attimo.", "is setting the table — one moment.")}</Micro>
            )}
          </div>
        </div>
      );
    };
    return (
      <Frame jolt={false}>
        <ReconnectVeil show={link === "lost" || reconnecting} busy={reconnecting} onRetry={reconnect} />
        <Head room={room} link={link} onLeave={() => setAskLeave(true)} onReconnect={reconnect} sound={sound} setSound={setSound} title={L("Al tavolo", "At the table")} lang={lang} setLang={setLang} />
        {solo && <SoloBar seat={seat} names={room.names} onFlip={() => setSeat(other(seat))} />}
        <LeaveDialog show={askLeave} onStay={() => setAskLeave(false)} onGo={leave} />
        <div className="fade">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <Micro>{L("Codice tavolo", "Table code")}</Micro>
              <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                {room.code.split("").map((ch, i) => (
                  <div key={i} style={{ ...codeTile, width: 34, height: 44, fontSize: 19 }}>
                    {ch}
                  </div>
                ))}
              </div>
            </div>
            <Micro style={{ textAlign: "right", maxWidth: 128, lineHeight: 1.6 }}>
              {seated ? `${room.names.B} ${L("è al tavolo", "is at the table")}` : L("In attesa del secondo giocatore…", "Waiting for the second player…")}
            </Micro>
          </div>

          {!seated && (
            <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: 12, border: `1px solid ${T.line}`, borderRadius: 12, flexWrap: "wrap" }}>
              <Micro style={{ textTransform: "none", letterSpacing: 0, fontSize: 12.5, lineHeight: 1.5, flex: 1, minWidth: 140 }}>
                {L("Dai il codice all’altro giocatore, oppure avvicinate i telefoni (Bump).", "Give the code to the other player, or tap phones together (Bump).")}
              </Micro>
              <button onClick={() => share(room.code)} style={sharePill}>
                {L("Condividi link", "Share link")}
              </button>
            </div>
          )}
          {!seated && msg && <Micro style={{ marginTop: 8, textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{msg}</Micro>}

          {seated && (
            <div style={{ marginTop: 16 }}>
              <Scoreboard board={board} names={room.names} />
            </div>
          )}

          <Rule />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Micro>{L("Gioco", "Game")}</Micro>
            <Micro style={{ textTransform: "none", letterSpacing: 0, fontSize: 11, color: T.ink30 }}>
              {host ? L("Scorri · tocca per le regole", "Swipe · tap for rules") : L("Sceglie l’host", "Host picks")}
            </Micro>
          </div>
          <div style={{ marginTop: 10 }}>
            <GameCarousel
              gkeys={gkeys}
              index={gIndex}
              host={host}
              onSettle={host ? (i) => pickGame(gkeys[i]) : null}
              front={frontFace}
              back={backFace}
            />
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
        <Head room={room} link={link} onLeave={() => setAskLeave(true)} onReconnect={reconnect} sound={sound} setSound={setSound} title={L("Prepara il mazzo", "Prepare the deck")} />
        {solo && <SoloBar seat={seat} names={room.names} onFlip={() => setSeat(other(seat))} />}
        <LeaveDialog show={askLeave} onStay={() => setAskLeave(false)} onGo={leave} />
        <Prepare
          room={room}
          seat={seat}
          shuffleTap={shuffleTap}
          shuffleDone={shuffleDone}
          cutAndDeal={cutAndDeal}
          liveCut={liveCut}
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
      ) : room.game === "diecimila" ? (
        <Farkle room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "scala" ? (
        <Scala room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
      ) : room.game === "peppa" ? (
        <Peppa room={room} gs={gs} seat={seat} mine={mine} slamId={slamId} commit={commit} />
      ) : room.game === "condottieri" ? (
        <Tactics room={room} gs={gs} seat={seat} commit={commit} />
      ) : room.game === "bestiario" ? (
        <Bestiario room={room} gs={gs} seat={seat} mine={mine} commit={commit} />
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
  fontFamily: MONO,
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

function Head({ room, link, onLeave, onReconnect, title, sound, setSound, lang, setLang }) {
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
          {room.code} · {link === "live" ? L("connesso", "connected") : link === "waiting" ? L("in attesa", "waiting") : L("disconnesso", "offline")}
        </Micro>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2, fontFamily: BRAND }}>{title}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {link === "lost" && (
          <button onClick={() => (onReconnect ? onReconnect() : window.location.reload())} style={{ ...plain, color: T.ink, fontWeight: 700 }}>
            {L("Riconnetti", "Reconnect")}
          </button>
        )}
        {setLang && <LangPill lang={lang} setLang={setLang} />}
        <button onClick={() => setSound(!sound)} style={plain}>
          {sound ? L("Audio on", "Sound on") : L("Audio off", "Sound off")}
        </button>
        <button onClick={onLeave} style={plain}>
          {L("Esci", "Exit")}
        </button>
      </div>
    </div>
  );
}

// The one language control: a pill showing the current language, tap to switch.
// Shown only on the home and game-selection screens.
function LangPill({ lang, setLang }) {
  return (
    <button
      onClick={() => setLang(lang === "it" ? "en" : "it")}
      title={lang === "it" ? "Switch to English" : "Passa all’italiano"}
      style={{ ...plain, cursor: "pointer", border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 11px", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: T.ink, background: "rgba(18,18,18,0.03)", WebkitTapHighlightColor: "transparent" }}
    >
      {lang.toUpperCase()}
    </button>
  );
}
const plain = {
  background: "none",
  border: "none",
  padding: 0,
  color: T.ink60,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: MONO,
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
                title={L(o.hint, o.he)}
                style={{ border: `1.5px solid ${T.ink}`, background: "transparent", borderRadius: 12, padding: "8px 14px", cursor: setOpt ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 84, WebkitTapHighlightColor: "transparent" }}
              >
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink60 }}>{L(o.label, o.le)}</span>
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
                title={L(o.hint, o.he)}
                style={{ ...plain, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 0", textAlign: "left", cursor: setOpt ? "pointer" : "default", borderTop: idx ? `1px solid ${T.line}` : "none", WebkitTapHighlightColor: "transparent" }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: BRAND, fontWeight: 600, fontSize: 15, color: on ? T.ink : T.ink60 }}>{L(o.label, o.le)}</span>
                  {o.hint && <span style={{ display: "block", fontSize: 12, color: T.ink30, marginTop: 2, lineHeight: 1.3 }}>{L(o.hint, o.he)}</span>}
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

/* A circular, inertial game picker. One card per game at 65% of the width so the
   neighbours peek; drag (host) to spin it, tap a peeking card to bring it to the
   middle, tap the middle card to flip it — its back holds the rules and the deal
   button. Only the middle card flips; focusing a neighbour never rotates it. */
const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : 0);
function GameCarousel({ gkeys, index, host, onSettle, front, back }) {
  const N = gkeys.length;
  const wrapRef = useRef(null);
  const outerRefs = useRef([]); // per-card positioned layer (translate lives here)
  const innerRefs = useRef([]); // per-card scale/opacity layer
  const [w, setW] = useState(360);
  const [flip, setFlip] = useState(false);
  const [midIdx, setMidIdx] = useState(((index % N) + N) % N); // which card index is in the middle (for the back face)
  const posRef = useRef(index); // continuous index — the single source of truth, NOT React state
  const raf = useRef(0);
  const drag = useRef(null);
  const gest = useRef({ blocked: false });
  const mod = (i) => ((i % N) + N) % N;
  const cardW = Math.round(w * 0.72); // wider cards…
  const step = Math.round(cardW * 0.9); // …sitting closer to the middle one
  const stepRef = useRef(step);
  stepRef.current = step;

  // Paint every card straight to the DOM from posRef — no React render per frame,
  // so the spin stays on the compositor and never stutters. Circular: each card
  // shows at whichever copy of itself is nearest the current position.
  const paint = () => {
    const pos = posRef.current;
    const st = stepRef.current;
    for (let i = 0; i < N; i++) {
      const outer = outerRefs.current[i];
      const inner = innerRefs.current[i];
      if (!outer) continue;
      let d = i - pos;
      d -= N * Math.round(d / N);
      const ad = Math.abs(d);
      const near = ad <= 2.4;
      outer.style.transform = `translate3d(calc(-50% + ${d * st}px), 0, 0)`;
      outer.style.zIndex = String(ad < 0.5 ? 30 : Math.max(1, 10 - Math.round(ad)));
      outer.style.visibility = near ? "visible" : "hidden";
      outer.style.pointerEvents = near ? "auto" : "none";
      if (inner) {
        const t = Math.min(1, ad);
        inner.style.transform = `scale(${1 - 0.14 * t})`;
        inner.style.opacity = String(1 - 0.55 * t);
      }
    }
  };
  useLayoutEffect(paint); // repaint after any render (mount, resize, flip)

  const commitMid = () => {
    const m = mod(Math.round(posRef.current));
    setMidIdx((cur) => (cur === m ? cur : m));
  };

  const animateTo = (target, done) => {
    cancelAnimationFrame(raf.current);
    const tick = () => {
      const cur = posRef.current;
      const diff = target - cur;
      if (Math.abs(diff) < 0.001) {
        posRef.current = target;
        paint();
        commitMid();
        done && done();
        return;
      }
      posRef.current = cur + diff * 0.16; // gentle ease
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => setW(el.clientWidth || 360);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  // follow the shared choice (guest sees the host pick; reconnect re-centres)
  useEffect(() => {
    if (mod(Math.round(posRef.current)) === mod(index)) return;
    setFlip(false);
    let best = index,
      bestD = Infinity;
    for (let k = -2; k <= 2; k++) {
      const cand = index + k * N;
      const d = Math.abs(cand - posRef.current);
      if (d < bestD) (bestD = d), (best = cand);
    }
    animateTo(best);
  }, [index]); // eslint-disable-line

  const settle = (target) => animateTo(target, () => host && onSettle && onSettle(mod(target)));

  const onDown = (e) => {
    if (flip) return; // flipped: let the card back scroll freely, no carousel drag
    cancelAnimationFrame(raf.current);
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x0: p.clientX, y0: p.clientY, pos0: posRef.current, axis: null, moved: 0, lastX: p.clientX, lastT: nowMs(), vel: 0 };
    gest.current.blocked = false;
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - d.x0;
    const dy = p.clientY - d.y0;
    if (!d.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (d.axis !== "x") return; // vertical → let the card back scroll; the page is left alone
    gest.current.blocked = true;
    d.moved = Math.max(d.moved, Math.abs(dx));
    if (host) {
      posRef.current = d.pos0 - dx / stepRef.current;
      paint(); // direct DOM — no setState while dragging
    }
    const t = nowMs();
    const dt = t - d.lastT || 16;
    d.vel = (p.clientX - d.lastX) / dt;
    d.lastX = p.clientX;
    d.lastT = t;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x" || d.moved < 6 || !host) return; // taps are handled per-card
    let v = (-d.vel / stepRef.current) * 16;
    v = Math.max(-1.3, Math.min(1.3, v));
    cancelAnimationFrame(raf.current);
    const glide = () => {
      v *= 0.92; // a little more roll before it settles
      posRef.current += v;
      paint();
      if (Math.abs(v) > 0.01) raf.current = requestAnimationFrame(glide);
      else settle(Math.round(posRef.current));
    };
    raf.current = requestAnimationFrame(glide);
  };

  // a tap on a card's FRONT: the middle one flips to its back; a neighbour is
  // brought to the middle (never rotating). The back never flips on a stray tap —
  // only its own ↺ button turns it over — so its toggles and scroll work freely.
  const onFace = (i) => {
    if (gest.current.blocked) return;
    if (i === mod(Math.round(posRef.current))) setFlip(true);
    else if (host) {
      setFlip(false);
      // spin to the nearest copy of card i
      let best = i,
        bestD = Infinity;
      for (let k = -2; k <= 2; k++) {
        const cand = i + k * N;
        const dd = Math.abs(cand - posRef.current);
        if (dd < bestD) (bestD = dd), (best = cand);
      }
      settle(best);
    }
  };

  return (
    <div
      ref={wrapRef}
      onTouchStart={onDown}
      onTouchMove={onMove}
      onTouchEnd={onUp}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      style={{ position: "relative", width: "100vw", marginLeft: "calc(-50vw + 50%)", height: "min(52vh, 460px)", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none", overflow: "visible" }}
    >
      {gkeys.map((key, i) => {
        const isMid = i === midIdx;
        const fld = isMid && flip;
        return (
          <div
            key={key}
            ref={(el) => (outerRefs.current[i] = el)}
            style={{ position: "absolute", left: "50%", top: 0, width: cardW, height: "100%", willChange: "transform", WebkitTapHighlightColor: "transparent" }}
          >
            <div ref={(el) => (innerRefs.current[i] = el)} style={{ width: "100%", height: "100%", willChange: "transform, opacity" }}>
              <div className="deck3d" style={{ width: "100%", height: "100%" }}>
                <div className={`deckcard${fld ? " flip" : ""}`} style={{ width: "100%", height: "100%" }}>
                  <div className="deckface" style={{ ...deckShell, pointerEvents: fld ? "none" : "auto", cursor: "pointer" }} onClick={() => onFace(i)}>
                    {front(key, isMid)}
                  </div>
                  <div className="deckface deckback" style={{ ...deckShell, pointerEvents: fld ? "auto" : "none" }}>
                    {isMid && (
                      <>
                        {back(key)}
                        <button onClick={() => setFlip(false)} title={L("gira", "flip")} style={{ ...plain, position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: 9, border: `1px solid ${T.line}`, background: T.bg, display: "grid", placeItems: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                          <Ico n="rotateL" s={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
const deckShell = {
  width: "100%",
  height: "100%",
  border: `1.5px solid ${T.line}`,
  borderRadius: 20,
  background: T.bg,
  boxShadow: "0 18px 44px rgba(18,18,18,0.14)",
  display: "flex",
  flexDirection: "column",
};

/* A key visual per game — paper cards, dice or the war-hex, in the house style. */
function GameArt({ game, size = 88 }) {
  const ink = T.ink,
    red = "#B23A2E",
    soft = "rgba(18,18,18,0.045)";
  const C = { fill: "#fff", stroke: ink, strokeWidth: 3, strokeLinejoin: "round" };
  const card = (cx, cy, rot, w = 30, h = 42) => <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx="5" {...C} transform={`rotate(${rot} ${cx} ${cy})`} />;
  const dot = (cx, cy, r = 3, c = ink) => <circle cx={cx} cy={cy} r={r} fill={c} />;
  const die = (cx, cy, faces, s = 26) => {
    const pts = { 1: [[0.5, 0.5]], 2: [[0.3, 0.3], [0.7, 0.7]], 3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]], 4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]], 5: [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]] };
    return (
      <g>
        <rect x={cx - s / 2} y={cy - s / 2} width={s} height={s} rx="6" {...C} />
        {(pts[faces] || []).map(([a, b], i) => dot(cx - s / 2 + a * s, cy - s / 2 + b * s, 2.4))}
      </g>
    );
  };
  let art;
  switch (game) {
    case "scopa":
    case "scienza":
      art = (<g>{card(34, 54, -15)}{card(50, 50, 0)}{card(66, 54, 15)}{dot(50, 50, 8, red)}</g>); break;
    case "ruba":
      art = (<g>{card(42, 56, -6)}{card(60, 50, 10)}<path d="M38 32c8-6 18-6 26 0" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" /><path d="M62 27l4 5-7 2z" fill={ink} /></g>); break;
    case "camicia":
      art = (<g>{card(44, 54, -12)}{card(58, 50, 12)}<path d="M50 18v12M44 24h12" stroke={red} strokeWidth="3" strokeLinecap="round" fill="none" /></g>); break;
    case "briscola":
      art = (<g>{card(50, 56, 0, 34, 46)}{dot(50, 60, 8, red)}<path d="M40 34l5-9 5 6 5-6 5 9z" fill="#E9B54B" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" /></g>); break;
    case "perudo":
      art = (<g>{die(38, 42, 3)}{die(64, 48, 5)}<path d="M30 64h40l-6 14H36z" {...C} /></g>); break;
    case "yahtzee":
      art = (<g>{die(30, 50, 5, 22)}{die(53, 43, 3, 22)}{die(72, 54, 2, 22)}</g>); break;
    case "diecimila":
      art = (<g>{die(32, 40, 1, 18)}{die(52, 36, 1, 18)}{die(70, 44, 5, 18)}{die(34, 62, 5, 18)}{die(54, 60, 1, 18)}{die(72, 66, 2, 18)}</g>); break;
    case "scala":
      art = (<g>{card(36, 62, -4, 24, 34)}{card(50, 52, -4, 24, 34)}{card(64, 42, -4, 24, 34)}</g>); break;
    case "peppa":
      art = (<g>{card(38, 52, -10)}{card(62, 52, 10)}<circle cx="62" cy="48" r="5.5" fill="none" stroke={red} strokeWidth="3" /><path d="M58.5 51.5l7-7" stroke={red} strokeWidth="3" strokeLinecap="round" /></g>); break;
    case "condottieri":
      art = (<g><polygon points="50,18 74,32 74,62 50,76 26,62 26,32" fill="rgba(46,120,90,0.12)" stroke={ink} strokeWidth="3" strokeLinejoin="round" />{die(50, 47, 3, 26)}</g>); break;
    case "bestiario":
      art = (
        <g stroke={ink} strokeWidth="2" fill="none">
          <rect x="30" y="30" width="40" height="40" rx="3" />
          <path d="M30 43.3h40M30 56.7h40M43.3 30v40M56.7 30v40" strokeWidth="1.4" />
          <circle cx="36.7" cy="63.3" r="4" fill={red} stroke="none" />
          <circle cx="63.3" cy="36.7" r="4" fill={ink} stroke="none" />
        </g>
      ); break;
    default:
      art = card(50, 50, 0);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }} aria-hidden="true">
      <circle cx="50" cy="50" r="47" fill={soft} />
      {art}
    </svg>
  );
}

/* Personal deck-face switch. Napoletane (Italian suits) or Francesi (♦♥♠♣). */
function FaceToggle({ french, setFrench }) {
  return (
    <Segmented
      options={[
        { v: false, label: L("Napoletane", "Neapolitan") },
        { v: true, label: L("Francesi ♦♥♠♣", "French ♦♥♠♣") },
      ]}
      value={french}
      onPick={(v) => setFrench(v)}
      style={{ marginTop: 8 }}
    />
  );
}

const joinUrl = (code) => (typeof location !== "undefined" ? location.origin : "") + "/?t=" + code;

/* The join link as a scannable QR, rendered as inline SVG (no external service). */
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
  const unit = isScopa ? L("punti", "points") : L("carte", "cards");
  const a = room.anim;
  // scopa-likes get the fuller CaptureReveal (hold the swept cards, then fly);
  // rubamazzo keeps the quick single-card fly toward the winning pile.
  const taken = a && a.kind !== "lay" && a.card && !isScopa ? { id: a.card, s: a.card[0], v: +a.card.slice(1) } : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {isScopa && <CaptureReveal room={room} seat={seat} />}
      {/* opponent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>{who(room, opp)}</span>
            {isScopa && <ScopeTag n={gs.scope[opp]} cards={gs.scopeCards && gs.scopeCards[opp]} />}
          </div>
          {showScores && (
            <Micro style={{ marginTop: 2 }}>
              {tally[opp]} {unit}
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
            {gs.done ? L("mano finita","hand over") : mine ? L("tocca a te","your turn") : L("aspetta","wait")}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: BRAND }}>
              {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
            </span>
            {isScopa && <ScopeTag n={gs.scope[seat]} cards={gs.scopeCards && gs.scopeCards[seat]} />}
          </div>
          {showScores && (
            <Micro>
              {tally[seat]} {unit}
            </Micro>
          )}
        </div>
        <div style={{ display: "flex", gap: gs.hands[seat].length > 3 ? 5 : 8, justifyContent: "center", minHeight: 96, flexWrap: "wrap" }}>
          {[...gs.hands[seat]].sort((a, b) => a.v - b.v || (a.s < b.s ? -1 : 1)).map((c) => (
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
        ? L("L’altro resta con la Peppa — hai vinto!", "The other is left with the Peppa — you win!")
        : L("Resti tu con la Peppa…", "You’re left with the Peppa…")
      : L("Pareggio", "Draw")
    : arranging
    ? iAmHolder
      ? L("Trascina per sistemare, su per offrire — poi presenta","Drag to arrange, up to offer — then present")
      : `${who(room, holder)} ${L("sta sistemando la sua mano", "is arranging their hand")}`
    : iAmDrawer
    ? L("Pesca una carta coperta","Draw a face-down card")
    : `${who(room, gs.turn)} ${L("sta pescando dalla tua mano", "is drawing from your hand")}`;

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
            <Micro>{last.paired ? L("coppia scartata","pair discarded") : `${who(room, last.seat)} ${L("la tiene","keeps it")}`}</Micro>
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
const uIco = (type, s = 14, c) => <Ico n={TACT.units[type]?.icon || "sword"} s={s} c={c} />;
// The unit token's outline reads its die: a d4 is a triangle, a d6 a square, a
// d8 an octagon — so shape alone tells you how big the die is.
const TOKEN = 34;
// shape reads the die by its face count: ● d2 · ▲ d3 · ◆ d4 · ■ d6 · ⬢ d8
const tokenKind = (max) => (max <= 2 ? "coin" : max === 3 ? "tri" : max <= 5 ? "dia" : max >= 8 ? "oct" : "sq");
function UnitToken({ type, label, col, stroke, sw = 2.4, dashed, floaty, dim }) {
  const kind = tokenKind(TACT.units[type]?.max || 6);
  const strokeCol = stroke || col;
  const dash = dashed ? "3.5 2.5" : undefined;
  const tri = kind === "tri";
  return (
    <div className={floaty ? "floaty" : ""} style={{ width: TOKEN, height: TOKEN, position: "relative", overflow: "visible", opacity: dim ? 0.45 : dashed ? 0.9 : 1 }}>
      <svg width={TOKEN} height={TOKEN} viewBox="0 0 34 34" style={{ position: "absolute", inset: 0, overflow: "visible", filter: "drop-shadow(0 2px 3px rgba(18,18,18,0.26))" }}>
        {kind === "coin" && <circle cx="17" cy="17" r="14.5" fill="#fff" stroke={strokeCol} strokeWidth={sw} strokeDasharray={dash} />}
        {kind === "sq" && <rect x="2.5" y="2.5" width="29" height="29" rx="7" fill="#fff" stroke={strokeCol} strokeWidth={sw} strokeDasharray={dash} />}
        {kind === "dia" && <path d="M17 2.5 31.5 17 17 31.5 2.5 17 Z" fill="#fff" stroke={strokeCol} strokeWidth={sw} strokeLinejoin="round" strokeDasharray={dash} />}
        {kind === "tri" && <path d="M17 2.4 32 30.6 2 30.6 Z" fill="#fff" stroke={strokeCol} strokeWidth={sw} strokeLinejoin="round" strokeDasharray={dash} />}
        {kind === "oct" && <polygon points="11,2.5 23,2.5 31.5,11 31.5,23 23,31.5 11,31.5 2.5,23 2.5,11" fill="#fff" stroke={strokeCol} strokeWidth={sw} strokeLinejoin="round" strokeDasharray={dash} />}
      </svg>
      {/* HP — the die's face — big and centred inside the shape */}
      <span style={{ position: "absolute", left: 0, right: 0, top: tri ? "64%" : "50%", transform: "translateY(-50%)", textAlign: "center", fontFamily: BRAND, fontWeight: 700, fontSize: 18, color: col, lineHeight: 1, pointerEvents: "none" }}>{label}</span>
      {/* class badge — its own colour bubble pinned to the corner, so the symbol reads at a glance */}
      <span style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: col, border: "1.6px solid #fff", boxShadow: "0 1px 3px rgba(18,18,18,0.4)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
        {uIco(type, 11, "#fff")}
      </span>
    </div>
  );
}
const THEXR = 23; // hex size (centre → corner) — small enough to pan a big map
const tpx = (q, r) => ({ x: THEXR * Math.sqrt(3) * (q + r / 2), y: THEXR * 1.5 * r });
const tCorners = (cx, cy) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + THEXR * Math.cos(a)).toFixed(1)},${(cy + THEXR * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

// Full-screen dice-roll reveal. The die tumbles and lands on its face; on a crit
// (top face) a fresh die is thrown next to it and the total climbs — so an
// exploding roll is something you watch happen, one die at a time. Fires on both
// devices from the shared anim id.
function RollReveal({ shot, onDone }) {
  const seq = shot && shot.rolls && shot.rolls.length ? shot.rolls : shot ? [Math.max(1, shot.dmg)] : [];
  const [face, setFace] = useState(1); // number tumbling on the die in flight
  const [done, setDone] = useState(0); // dice that have settled
  const [live, setLive] = useState(true); // a die is currently tumbling
  useEffect(() => {
    if (!shot) return;
    setDone(0);
    setLive(true);
    const fmax = Math.max(2, shot.faceMax || 8);
    const timers = [];
    let iv = null;
    const toss = (i) => {
      setLive(true);
      iv = setInterval(() => setFace(1 + Math.floor(Math.random() * fmax)), 55);
      timers.push(
        setTimeout(() => {
          clearInterval(iv);
          setFace(seq[i]);
          setLive(false);
          setDone(i + 1);
          if (i + 1 < seq.length) timers.push(setTimeout(() => toss(i + 1), 600)); // it exploded — throw the next
          else timers.push(setTimeout(() => onDone && onDone(), shot.crit ? 1700 : 1150));
        }, i === 0 ? 540 : 470)
      );
    };
    toss(0);
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, [shot && shot.id]);
  if (!shot) return null;
  const col = TSIDE[shot.side] || T.ink;
  const crit = shot.crit && seq.length > 1;
  const complete = done >= seq.length && !live;
  const shown = Math.min(seq.length, done + (live ? 1 : 0));
  const runTotal = seq.slice(0, done).reduce((a, b) => a + b, 0) + (complete ? shot.bonus || 0 : 0);
  // build the dice row as a flat, keyed list (named React import → no Fragment)
  const row = [];
  for (let i = 0; i < shown; i++) {
    const settled = i < done;
    const val = settled ? seq[i] : face;
    const isTop = settled && crit && seq[i] === shot.faceMax; // a die that exploded
    const big = !settled; // the die in flight is the big one
    if (i > 0) row.push(<span key={`p${i}`} style={{ color: "rgba(255,255,255,0.55)", fontFamily: BRAND, fontWeight: 700, fontSize: 24 }}>+</span>);
    row.push(
      <div
        key={`${shot.id}-d${i}-${settled ? "s" : "l"}`}
        className={big ? "tumble" : isTop ? "critshake" : "settle"}
        style={{
          width: big ? 104 : 72,
          height: big ? 104 : 72,
          borderRadius: big ? 18 : 13,
          background: "#fff",
          border: `3px solid ${isTop ? "#E9B54B" : col}`,
          boxShadow: "0 14px 40px rgba(0,0,0,0.5)",
          display: "grid",
          placeItems: "center",
          fontFamily: BRAND,
          fontWeight: 700,
          fontSize: big ? 56 : 38,
          color: isTop ? "#C98A1A" : col,
          transition: "width 150ms ease, height 150ms ease, font-size 150ms ease",
        }}
      >
        {val}
      </div>
    );
  }
  if (complete && (shot.bonus || 0) > 0) {
    row.push(<span key="pb" style={{ color: "rgba(255,255,255,0.55)", fontFamily: BRAND, fontWeight: 700, fontSize: 24 }}>+</span>);
    row.push(
      <div key="bonus" className="settle" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, color: "#E9B54B" }}>
        <Ico n="flag" s={26} c="#E9B54B" />
        <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 14 }}>+{shot.bonus}</span>
      </div>
    );
  }
  return (
    <div onClick={onDone} style={{ position: "fixed", inset: 0, zIndex: 84, background: SCRIM, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
          {uIco(shot.atkType, 13, "rgba(255,255,255,0.75)")} {L("attacca","attacks")} {uIco(shot.tgtType, 13, "rgba(255,255,255,0.75)")}
        </div>
        {crit && done >= 1 && (
          <div className="settle" style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 20, color: "#E9B54B", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
            {L("CRITICO!","CRIT!")} <Ico n="burst" s={18} c="#E9B54B" sw={2} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 8, maxWidth: 330 }}>{row}</div>
        <div className="settle" style={{ textAlign: "center", minHeight: 40 }}>
          {done >= 1 && (
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 34, color: "#fff", lineHeight: 1 }}>
              {complete ? shot.dmg : runTotal}
              <span style={{ fontSize: 16, fontWeight: 600, marginLeft: 5 }}>{L("danni","damage")}</span>
            </div>
          )}
          {complete && shot.killed && <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 15, color: "#E9B54B", marginTop: 4 }}>{L("abbattuto!","down!")}</div>}
          {complete && shot.splash > 0 && (
            <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14, color: "#E9B54B", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <Ico n="spark" s={15} c="#E9B54B" /> {L("e","and")} {shot.splash} {L("nell’area","in the area")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Animated 3/4-slide "how to play", little text.
const TACT_SLIDES = [
  { icon: "dice", title: "Ogni pedina è un dado", body: "La faccia mostra la vita. Fante d8, Arciere d6, Esploratore d2.", te: "Every piece is a die", be: "The face shows its life. Fante d8, Arciere d6, Esploratore d2." },
  { icon: "sword", title: "Ferito colpisce meno", body: "Attacchi tirando da 1 alla tua vita: più sei ferito, meno fai male.", te: "Wounded hits softer", be: "You attack by rolling 1 to your life: the more hurt you are, the less you deal." },
  { icon: "burst", title: "Il colpo pieno esplode", body: "Se tiri la faccia più alta è un Critico: rilanci il dado e sommi. Può incatenarsi — un colpo può valere doppio o più.", te: "A full hit explodes", be: "Roll your top face and it's a Crit: roll again and add. It can chain — one hit can be worth double or more." },
  { icon: "spark", title: "Il Mago colpisce due caselle", body: "Miri una casella a tiro (2–3, non un ostacolo) e una vicina: lo stesso danno investe chiunque stia lì — anche le tue pedine. Attento al fuoco amico.", te: "The Mago hits two hexes", be: "Aim one hex in range (2–3, not an obstacle) and one next to it: the same damage hits anyone there — your own pieces too. Mind the friendly fire." },
  { icon: "bow", title: "Uno per uno", body: "A turno, una mossa a testa: attivi una pedina (la sposti e attacchi), fino a due volte prima che riposi.", te: "One at a time", be: "Take turns, one move each: activate a piece (move it and attack), up to twice before it rests." },
  { icon: "flag", title: "Come si vince", body: "Stermina l’altro, espugna il suo castello (tienilo un turno sotto tiro), o conquista tutti gli stendardi. Uno stendardo dà +1 danno a chi ci combatte.", te: "How to win", be: "Wipe out the other, take their castle (hold it a turn under fire), or seize every banner. A banner gives +1 damage to whoever fights on it." },
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
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 22, color: T.ink, marginTop: 12 }}>{L(s.title, s.te)}</div>
        <p style={{ color: T.ink60, fontSize: 14.5, lineHeight: 1.5, margin: "8px 0 0" }}>{L(s.body, s.be)}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "18px 0 16px" }}>
          {TACT_SLIDES.map((_, k) => (
            <span key={k} style={{ width: 7, height: 7, borderRadius: 999, background: k === i ? T.ink : T.line }} />
          ))}
        </div>
        <Button kind="solid" full onClick={() => (last ? onClose() : setI(i + 1))}>
          {last ? L("Giochiamo!", "Let's play!") : L("Avanti →", "Next →")}
        </Button>
      </div>
    </div>
  );
}

// The recruit screen (full rules): spend a budget across the pool of classes,
// building a company of 3–6. Tap a class to add it, tap a drafted chip to drop it.
function TacticsDraft({ draft, setDraft, onConfirm, tone }) {
  const spent = tacticsCompanyCost(draft);
  const left = TACT.BUDGET - spent;
  const full = draft.length >= TACT.MAX_UNITS;
  const ready = draft.length >= TACT.MIN_UNITS;
  const add = (t) => {
    if (!full && TACT.units[t].cost <= left) setDraft([...draft, t]);
  };
  const removeAt = (i) => setDraft(draft.filter((_, j) => j !== i));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <Micro>{L("Recluta", "Recruit")} · {TACT.MIN_UNITS}–{TACT.MAX_UNITS} {L("pedine", "pieces")}</Micro>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 13, color: left > 0 ? T.ink : T.ink30 }}>{left} punti</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {TYPE_ORDER.map((t) => {
          const u = TACT.units[t];
          const can = !full && u.cost <= left;
          const rng = u.min === u.rng ? `${u.rng}` : `${u.min}–${u.rng}`;
          return (
            <button
              key={t}
              onClick={() => add(t)}
              disabled={!can}
              style={{ ...plain, textAlign: "left", border: `1.5px solid ${can ? T.ink : T.line}`, borderRadius: 12, padding: "9px 10px", cursor: can ? "pointer" : "default", opacity: can ? 1 : 0.5, WebkitTapHighlightColor: "transparent" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: BRAND, fontWeight: 700, fontSize: 13 }}>
                  {uIco(t, 15)} {u.name}
                </span>
                <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 13 }}>{u.cost}</span>
              </div>
              <Micro style={{ marginTop: 4 }}>d{u.max} · muove {u.move} · tiro {rng}</Micro>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, minHeight: 32 }}>
        {draft.length === 0 && <Micro>{L("Tocca una classe per aggiungerla", "Tap a class to add it")}</Micro>}
        {draft.map((t, i) => (
          <button
            key={i}
            onClick={() => removeAt(i)}
            style={{ ...plain, display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${T.line}`, borderRadius: 999, padding: "5px 10px", cursor: "pointer", fontFamily: BRAND, fontWeight: 600, fontSize: 12.5, WebkitTapHighlightColor: "transparent" }}
          >
            {uIco(t, 13)} {TACT.units[t].name} <Ico n="minus" s={12} c={T.ink30} />
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <Button kind="solid" full tone={tone} onClick={onConfirm} disabled={!ready}>
          {ready ? `${L("Schiera", "Deploy")} ${draft.length} ${L("pedine", "pieces")}` : `${L("Almeno", "At least")} ${TACT.MIN_UNITS} ${L("pedine", "pieces")}`}
        </Button>
      </div>
    </div>
  );
}

function Tactics({ room, gs, seat, commit }) {
  const board = gs.board;
  const me = TSIDE[seat]; // this device's colour — blue for A, red for B; own chrome wears it
  const myTurn = gs.turn === seat && !gs.done; // roster/deploy hand-off, and whose turn it is in battle
  const canPlay = myTurn && gs.phase === "battle"; // battle: act on your own units when it's your move
  const [sel, setSel] = useState(null); // selected own unit id (battle)
  const [dest, setDest] = useState(null); // staged move hex key
  const [blast, setBlast] = useState(null); // area caster's aim: { a: hexKey, b: hexKey|null }
  const [inspect, setInspect] = useState(null); // enemy unit id being previewed (move + range)
  const [info, setInfo] = useState(null); // tapped element info: { k:"unit", id } | { k, side } for terrain
  // setup (roster + deployment) is done locally and privately, then locked in
  const [draft, setDraft] = useState([]); // company being recruited
  const [step, setStep] = useState("roster"); // setup sub-step: "roster" → "deploy"
  const [layout, setLayout] = useState([]); // this seat's placements
  const [submitted, setSubmitted] = useState(false); // I've locked in and I'm waiting for the reveal
  const lockedLayout = useRef(null); // survives a re-render so a lost setup write can be re-sent
  const [banner, setBanner] = useState(null); // big phase title card: { title, sub }
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [help, setHelp] = useState(false);
  const [shot, setShot] = useState(null);
  const drag = useRef(null);
  const pinch = useRef(null); // two-finger zoom gesture state
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
      setShot({ id: a.id, dmg: gs.last.dmg, crit: !!gs.last.crit, killed: !!gs.last.killed, atkType: gs.last.atkType, tgtType: gs.last.tgtType, side: room.ev.seat, faceMax: gs.last.die || TACT.units[gs.last.atkType]?.max || 8, splash: room.ev.splash || 0, rolls: gs.last.rolls || null, bonus: gs.last.bonus || 0 });
    }
  }, [room?.anim?.id]);

  // clear any stale battle selection when the turn/phase flips
  useEffect(() => {
    setSel(null);
    setDest(null);
    setInspect(null);
  }, [gs.turn, gs.phase]);

  // setup is arranged locally and privately. Reset the whole setup when the
  // phase changes, when this seat has locked in, or when the viewpoint flips
  // seats in solo — but never merely because the other side locked in first.
  const mySetup = gs.phase === "setup" && gs.setup && gs.setup[seat] == null && !gs.done; // still setting up
  useEffect(() => {
    setStep("roster");
    setDraft([]);
    setLayout([]);
    setSubmitted(false);
    lockedLayout.current = null;
  }, [seat, gs.phase]);

  // if my locked-in company never made it into the shared state (a setup write
  // dropped or overwritten under the live transport), re-send it — no turn to
  // wait on, so this can't hang.
  useEffect(() => {
    if (gs.phase === "setup" && !gs.done && gs.setup && gs.setup[seat] == null && lockedLayout.current) {
      commit(tacticsSetup(gs, seat, lockedLayout.current));
    }
  }, [gs.phase, gs.setup && gs.setup[seat]]); // eslint-disable-line

  // self-heal: if both companies are locked in but the battle never opened, open it
  useEffect(() => {
    if (gs.phase === "setup" && !gs.done && gs.setup && gs.setup.A != null && gs.setup.B != null) {
      commit(tacticsResolveSetup(gs));
    }
  }, [gs.phase, gs.setup && gs.setup.A, gs.setup && gs.setup.B, gs.turn, seat]);

  // big phase title cards: ROSTER / DEPLOYMENT while setting up, ALLE ARMI when
  // the battle opens and both companies are revealed at once
  useEffect(() => {
    let card = null;
    if (gs.phase === "battle" && !gs.done) card = { title: L("ALLE ARMI", "TO ARMS"), sub: null };
    else if (gs.phase === "setup" && mySetup) card = step === "roster" ? { title: L("COMPAGNIA", "COMPANY"), sub: L("Fase 1", "Phase 1") } : { title: L("SCHIERAMENTO", "DEPLOYMENT"), sub: L("Fase 2", "Phase 2") };
    if (!card) return;
    setBanner(card);
    const t = setTimeout(() => setBanner(null), card.sub ? 1300 : 1600);
    return () => clearTimeout(t);
  }, [gs.phase, step, mySetup]);

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
  const active = unit && canPlay;
  const reach = active ? tacticsReach(gs, unit) : {};
  const stagePos = unit ? (dest ? unhkey(dest) : { q: unit.q, r: unit.r }) : null;
  const stageKey = unit ? hkey(stagePos.q, stagePos.r) : null;
  // resting on your own fountain/castle heals but forbids attacking this turn
  const healing = active && tacticsHeals(gs, seat, stageKey);
  const staged = { ...unit, ...stagePos };
  const targetIds = active && !healing ? tacticsTargets({ ...gs, units: { ...gs.units, [sel]: staged } }, staged) : [];
  const targetSet = new Set(targetIds.map((id) => hkey(gs.units[id].q, gs.units[id].r)));
  // area caster (Mago): aims a first hex (an enemy in range) then a bordering
  // second hex; the roll lands on every unit in the two — friend or foe.
  const isMage = active && !healing && !!TACT.units[unit.type].aoe;
  const cellKeys = new Set(board.cells.map((c) => hkey(c.q, c.r)));
  const mateSet = new Set();
  if (isMage && blast && blast.a) {
    const a = unhkey(blast.a);
    for (const [dq, dr] of HEX_DIRS) {
      const nk = hkey(a.q + dq, a.r + dr);
      if (cellKeys.has(nk) && !board.blocked[nk]) mateSet.add(nk);
    }
  }
  const fireBlast = () => {
    if (!sel || !blast || !blast.a || !blast.b) return;
    commit(tacticsActivate(gs, seat, sel, dest, { kind: "blast", cells: [blast.a, blast.b] }));
    setSel(null);
    setDest(null);
    setBlast(null);
    setInspect(null);
    setInfo(null);
  };
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

  // placement (the deploy sub-step of setup): this seat drops its drafted company
  // onto its own castle's zone, privately — the opponent sees none of it.
  const myPlace = mySetup && step === "deploy" && !gs.done;
  const layoutKeys = new Set(layout.map((p) => hkey(p.q, p.r)));
  const nextType = myPlace ? draft[layout.length] : null; // next piece to place, null once all placed
  const deploySet = myPlace && nextType ? new Set(board.cells.map((c) => hkey(c.q, c.r)).filter((k) => tacticsDeployable(gs, seat, k) && !layoutKeys.has(k))) : new Set();

  const tapHex = (k) => {
    if (moved.current) return;
    const sp = specialMark(k);
    if (gs.phase === "setup") {
      if (myPlace && nextType && deploySet.has(k)) {
        const { q, r } = unhkey(k);
        setLayout([...layout, { type: nextType, q, r }]);
        setInfo(null);
      } else if (sp) setInfo(sp); // tap a keep/fountain/flag for info even while placing
      return;
    }
    // area caster mid-aim: an adjacent hex fixes the second target (or clears it)
    if (canPlay && unit && isMage && blast && blast.a) {
      if (k === blast.a) {
        setBlast(null);
        return;
      }
      if (!blast.b && mateSet.has(k)) {
        setBlast({ a: blast.a, b: k });
        return;
      }
    }
    // battle: moving has priority when a unit of yours is selected on your turn
    if (canPlay && unit) {
      const uk = hkey(unit.q, unit.r);
      if (k === uk) {
        setDest(null);
        return;
      }
      if (reach[k] !== undefined) {
        setDest(k);
        setBlast(null);
        return;
      }
    }
    // otherwise show info for a special hex, or dismiss it
    setInfo(sp || null);
  };
  const tapUnit = (id) => {
    if (moved.current) return;
    const u = gs.units[id];
    if (!u) return;
    const hk = hkey(u.q, u.r);
    // an aiming Mago claims taps first: a valid enemy fixes the first hex, then any
    // unit on a bordering hex (even one of yours) fixes the second — before the
    // usual select / attack / inspect.
    if (canPlay && sel && isMage) {
      if (!blast || !blast.a) {
        if (targetIds.includes(id)) {
          setBlast({ a: hk, b: null });
          setInfo({ k: "unit", id });
          return;
        }
      } else if (!blast.b) {
        if (hk === blast.a) {
          setBlast(null);
          return;
        }
        if (mateSet.has(hk)) {
          setBlast({ a: blast.a, b: hk });
          setInfo({ k: "unit", id });
          return;
        }
      } else if (hk === blast.a) {
        setBlast(null);
        return;
      }
    }
    setInfo({ k: "unit", id }); // tapping any unit shows its card
    if (gs.phase !== "battle") return;
    if (u.owner === seat) {
      if (canPlay && tacticsReady(gs, id)) {
        setSel(id);
        setDest(null);
        setBlast(null);
        setInspect(null);
      }
      return;
    }
    // enemy unit: single-target attack (non-casters), otherwise preview its reach
    if (canPlay && sel && !isMage && targetIds.includes(id)) {
      commit(tacticsActivate(gs, seat, sel, dest, { kind: "attack", targetId: id }));
      setSel(null);
      setDest(null);
      setInspect(null);
      setInfo(null);
      return;
    }
    setInspect((cur) => (cur === id ? null : id));
  };
  const endUnit = () => {
    if (!sel) return;
    commit(tacticsActivate(gs, seat, sel, dest, null));
    setSel(null);
    setDest(null);
    setBlast(null);
    setInspect(null);
  };
  // lock in the whole setup (company + placements); if it isn't our turn to
  // Lock in my own company at once — no turn to wait for. Remember it so a lost
  // write can be re-sent (see the resubmit effect).
  const submitSetup = () => {
    if (draft.length === 0 || layout.length !== draft.length) return;
    lockedLayout.current = layout;
    setSubmitted(true);
    commit(tacticsSetup(gs, seat, layout));
  };

  // pan (drag / one finger) and pinch-zoom (two fingers), with tap-vs-gesture
  // disambiguation. Pinch keeps the point between the fingers pinned under them.
  const dist2 = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const localMid = (t) => {
    const el = stageRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
  };
  const onDown = (e) => {
    if (e.touches && e.touches.length >= 2) {
      const m = localMid(e.touches);
      pinch.current = { d0: dist2(e.touches), z0: zoom, bx: (m.x - pan.x) / zoom, by: (m.y - pan.y) / zoom };
      drag.current = null;
      moved.current = true; // a pinch is never a tap
      return;
    }
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, px: pan.x, py: pan.y };
    moved.current = false;
  };
  const onMove = (e) => {
    if (pinch.current && e.touches && e.touches.length >= 2) {
      const pc = pinch.current;
      const nz = Math.max(0.55, Math.min(1.7, pc.z0 * (dist2(e.touches) / pc.d0)));
      const m = localMid(e.touches);
      setPan({ x: m.x - nz * pc.bx, y: m.y - nz * pc.by });
      setZoom(nz);
      return;
    }
    if (!drag.current) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - drag.current.x,
      dy = p.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 7) moved.current = true;
    if (moved.current) setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
  };
  const onUp = (e) => {
    if (pinch.current && (!e || !e.touches || e.touches.length < 2)) pinch.current = null;
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
          ? L("Hai preso il castello — vittoria!", "You took the castle — victory!")
          : gs.how === "flags"
          ? L("Hai preso tutti gli stendardi — vittoria!", "You hold every banner — victory!")
          : L("Nemico sterminato — vittoria!", "Enemy wiped out — victory!")
        : L("Sconfitta…", "Defeat…")
      : L("Pareggio", "Draw")
    : gs.phase === "setup"
    ? !mySetup
      ? `${L("Pronto — aspetto", "Ready — waiting for")} ${who(room, other(seat))}`
      : step === "roster"
      ? L("Recluta la tua compagnia — di nascosto", "Recruit your company — in secret")
      : nextType
      ? `${L("Piazza vicino al tuo castello", "Place near your castle")} — ${TACT.units[nextType]?.name} (${draft.length - layout.length} ${L("da piazzare", "to place")})`
      : submitted
      ? `${L("Pronto — aspetto", "Ready — waiting for")} ${who(room, other(seat))}`
      : L("Compagnia schierata — conferma", "Company deployed — confirm")
    : sel
    ? isMage
      ? blast && blast.a && blast.b
        ? L("Due caselle in mira — Lancia", "Two hexes aimed — Cast")
        : blast && blast.a
        ? L("Scegli la 2ª casella, accanto alla prima", "Pick the 2nd hex, next to the first")
        : L("Tocca un nemico per mirare — colpisce due caselle, anche i tuoi", "Tap an enemy to aim — hits two hexes, your own too")
      : healing
      ? L("In cura qui — niente attacco", "Healing here — no attack")
      : dest
      ? L("Tocca un nemico in rosso, o Fermati qui", "Tap an enemy in red, or Stop here")
      : L("Muovi, o colpisci un nemico in rosso", "Move, or hit an enemy in red")
    : canPlay
    ? L("Tocca a te — muovi una pedina", "Your turn — move a piece")
    : `${L("Turno di", "Turn:")} ${who(room, gs.turn)}`;
  const insU = insUnit ? TACT.units[insUnit.type] : null;
  const status =
    insUnit && !sel
      ? `${insU.name} ${L("nemico — muove fino a", "enemy — moves up to")} ${insU.move}, ${L("colpisce a", "hits at")} ${insU.min === insU.rng ? insU.rng : `${insU.min}–${insU.rng}`}`
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
    if ((board.banners || []).includes(k)) {
      const holder = gs.order.find((id) => hkey(gs.units[id].q, gs.units[id].r) === k);
      return { kind: "banner", side: holder ? gs.units[holder].owner : null };
    }
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 132px)" }}>
      {shot && <RollReveal shot={shot} onDone={() => setShot(null)} />}
      {help && <TacticsHowTo onClose={() => setHelp(false)} />}
      {banner && (
        <div style={{ position: "fixed", inset: 0, zIndex: 62, display: "grid", placeItems: "center", pointerEvents: "none", padding: 20 }}>
          <div key={banner.title} className="pop" style={{ textAlign: "center", lineHeight: 1 }}>
            <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(42px, 13vw, 96px)", color: me, letterSpacing: "-0.02em", textShadow: "0 4px 0 rgba(18,18,18,0.07)" }}>{banner.title}</div>
            {banner.sub && <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.32em", textTransform: "uppercase", color: T.ink60, marginTop: 12, fontWeight: 600 }}>{banner.sub}</div>}
          </div>
        </div>
      )}

      {/* top bar: phase / move count + view controls + how-to */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: TSIDE[gs.turn], display: "inline-block", opacity: gs.done ? 0.3 : 1 }} />
          <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 13 }}>
            {gs.phase === "battle" ? `${L("Mossa", "Move")} ${Math.min(gs.moves + 1, TACT.MOVE_CAP)} ${L("di", "of")} ${TACT.MOVE_CAP}` : gs.phase === "setup" ? (step === "roster" ? L("Compagnia", "Company") : L("Schieramento", "Deployment")) : "…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={vbtn} onClick={() => zoomBy(1.2)} title="zoom"><Ico n="plus" s={16} /></button>
          <button style={vbtn} onClick={() => zoomBy(1 / 1.2)} title="zoom"><Ico n="minus" s={16} /></button>
          <button style={vbtn} onClick={resetView} title={L("centra sul castello", "center on your castle")}><Ico n="recenter" s={16} /></button>
          <button style={vbtn} onClick={() => setHelp(true)} title={L("come si gioca", "how to play")}><Ico n="help" s={16} /></button>
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
              const isAimA = blast && blast.a === k; // Mago's first target hex
              const isAimB = blast && blast.b === k; // its bordering second hex
              const isMate = isMage && blast && blast.a && !blast.b && mateSet.has(k); // candidate second hexes
              let fill = blocked ? "rgba(18,18,18,0.28)" : "rgba(255,255,255,0.9)";
              if (sp && sp.kind === "fount") fill = "rgba(44,120,160,0.22)";
              if (sp && sp.kind === "banner") fill = sp.side ? rgbaOf(TSIDE[sp.side], 0.2) : "rgba(184,134,43,0.16)"; // contested field objective
              if (isInsReach) fill = rgbaOf(insCol, 0.16); // where the selected enemy could step
              if (isInsThreat) fill = rgbaOf(insCol, 0.3); // what the selected enemy threatens
              if (isThreat) fill = "rgba(165,52,47,0.12)"; // attack area — a light red wash
              if (isReach || isDest) fill = "rgba(46,120,90,0.30)"; // where you can move
              if (isDeploy) fill = "rgba(184,134,43,0.24)";
              if (isTarget) fill = "rgba(165,52,47,0.34)"; // an enemy you can hit
              if (isMate) fill = "rgba(233,181,75,0.26)"; // where the blast can spill
              if (isAimA || isAimB) fill = "rgba(233,181,75,0.5)"; // the two hexes it will hit
              const stroke = isAimA || isAimB
                ? "#C98A1A"
                : isMate
                ? "#E9B54B"
                : isSelHex
                ? me
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
                : sp && sp.kind === "banner"
                ? sp.side
                  ? TSIDE[sp.side]
                  : "#B8862B"
                : T.line;
              return (
                <g key={k}>
                  <polygon
                    points={tCorners(p.x, p.y)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isAimA || isAimB ? 2.6 : isSelHex || isTarget || isInsHex || (sp && sp.kind === "castle") ? 2.2 : isThreat || isInsThreat || isMate || (sp && sp.kind === "banner") ? 1.5 : 1}
                    className={isTarget || isDeploy || isMate ? "hexpulse" : ""}
                    onClick={() => tapHex(k)}
                    style={{ cursor: isDeploy || (canPlay && (isReach || isTarget || isDest || isSelHex || isAimA || isAimB || isMate)) ? "pointer" : "default" }}
                  />
                  {sp && (
                    <g transform={`translate(${p.x - 7} ${p.y - 7})`} style={{ pointerEvents: "none" }}>
                      <Ico
                        n={sp.kind === "castle" ? "castle" : sp.kind === "banner" ? "flag" : "drop"}
                        s={14}
                        c={sp.kind === "castle" ? TSIDE[sp.side] : sp.kind === "banner" ? (sp.side ? TSIDE[sp.side] : "#9A7B2E") : "#2C7AA0"}
                        sw={1.9}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* unit dice, flat on the board — shape shows the die (△ d4 · □ d6 · ⯃ d8) */}
          {gs.order.map((id) => {
            const u = gs.units[id];
            const showAt = sel === id && dest ? unhkey(dest) : { q: u.q, r: u.r };
            const p = at(showAt.q, showAt.r);
            const resting = gs.phase === "battle" && !tacticsReady(gs, id);
            const isSel = sel === id;
            const isIns = inspect === id;
            const isTgt = targetSet.has(hkey(u.q, u.r)) && !(sel === id);
            const col = TSIDE[u.owner];
            const stroke = isSel ? T.ink : isTgt ? "#A5342F" : col;
            return (
              <div
                key={id}
                onClick={() => tapUnit(id)}
                style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", cursor: canPlay ? "pointer" : "default", transition: "left 200ms ease, top 200ms ease" }}
              >
                <UnitToken type={u.type} label={u.hp} col={col} stroke={stroke} sw={isSel || isTgt || isIns ? 3.2 : 2.4} floaty={isSel} dim={resting} />
              </div>
            );
          })}

          {/* your own setup pieces — only you see them. Dashed while you arrange
              (tap to pick one back up), solid once you've locked them in. */}
          {gs.phase === "setup" &&
            (gs.setup[seat] || layout).map((pl, i) => {
              const p = at(pl.q, pl.r);
              const col = TSIDE[seat];
              const locked = gs.setup[seat] != null;
              return (
                <div
                  key={`stg${i}`}
                  onClick={() => (locked ? null : setLayout(layout.filter((_, j) => j !== i)))}
                  style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", cursor: locked ? "default" : "pointer", transition: "left 160ms ease, top 160ms ease" }}
                >
                  <UnitToken type={pl.type} label={TACT.units[pl.type].max} col={col} dashed={!locked} />
                </div>
              );
            })}
        </div>
      </div>

      {/* status + actions */}
      <div style={{ marginTop: 10, textAlign: "center", minHeight: 22 }}>
        <div key={status} className="swap" style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 15 }}>{status}</div>
      </div>

      {/* tap any element for info: a unit's card, or what a keep/fountain/flag does */}
      {(() => {
        const iu = info && info.k === "unit" ? gs.units[info.id] : null;
        const it = info && info.kind ? info : null;
        if (!iu && !it) return null;
        let icon, tint, title, desc;
        if (iu) {
          const d = TACT.units[iu.type];
          icon = d.icon;
          tint = TSIDE[iu.owner];
          title = `${d.name}${iu.owner !== seat ? L(" · nemico", " · enemy") : ""}`;
          desc = `d${d.max} · ${L("vita","life")} ${iu.hp}/${iu.max} · ${L("muove","moves")} ${d.move} · ${L("tiro","range")} ${d.min === d.rng ? d.rng : `${d.min}–${d.rng}`}${d.fly ? L(" · vola sopra gli ostacoli; su un ostacolo è al sicuro dai corpo a corpo", " · flies over obstacles; on one it's safe from melee") : ""}${d.aoe ? L(" · colpisce due caselle vicine (anche i tuoi)", " · hits two adjacent hexes (your own too)") : ""}`;
        } else if (it.kind === "castle") {
          icon = "castle";
          tint = TSIDE[it.side];
          title = `${L("Castello","Castle")} ${it.side === seat ? L("· tuo","· yours") : L("· nemico","· enemy")}`;
          desc = it.side === seat ? L("Ti risana del tutto. Difendilo.", "Heals you fully. Defend it.") : L("Entra e resisti un turno per espugnarlo e vincere.", "Enter and survive a turn to take it and win.");
        } else if (it.kind === "fount") {
          icon = "drop";
          tint = "#2C7AA0";
          title = L("Fontana", "Fountain");
          desc = L("Cura +3 a chi ci sosta. È sul fianco, lontana dai castelli.", "Heals +3 to whoever rests on it. Out on the flank, away from the castles.");
        } else {
          icon = "flag";
          tint = it.side ? TSIDE[it.side] : "#9A7B2E";
          title = it.side ? `${L("Stendardo · di", "Banner · held by")} ${who(room, it.side)}` : L("Stendardo · libero", "Banner · free");
          desc = L("+1 danno se attacchi standoci sopra. Tienili tutti per vincere.", "+1 damage attacking from it. Hold them all to win.");
        }
        return (
          <div style={{ marginTop: 8, border: `1px solid ${T.line}`, borderRadius: 12, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <Ico n={icon} s={20} c={tint} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 13.5, color: T.ink }}>{title}</div>
              <Micro style={{ marginTop: 1 }}>{desc}</Micro>
            </div>
            <button onClick={() => setInfo(null)} style={{ ...plain, cursor: "pointer", padding: 4, color: T.ink30, display: "grid", placeItems: "center", WebkitTapHighlightColor: "transparent" }}>
              <Ico n="plus" s={15} c={T.ink30} style={{ transform: "rotate(45deg)" }} />
            </button>
          </div>
        );
      })()}

      {mySetup && step === "roster" && (
        gs.simple ? (
          <div style={{ marginTop: 12 }}>
            <Micro style={{ textAlign: "center" }}>Compagnia di 4 · almeno un Fante e un Arciere</Micro>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {[1, 2, 3].map((f) => (
                <button
                  key={f}
                  onClick={() => { setDraft([...Array(f).fill("fante"), ...Array(4 - f).fill("arciere")]); setLayout([]); setStep("deploy"); }}
                  style={{ ...plain, flex: 1, border: `1.5px solid ${me}`, color: me, borderRadius: 12, padding: "10px 6px", cursor: "pointer", fontFamily: BRAND, fontWeight: 600, fontSize: 13, WebkitTapHighlightColor: "transparent" }}
                >
                  {f} {uIco("fante", 14)} · {4 - f} {uIco("arciere", 14)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <TacticsDraft draft={draft} setDraft={setDraft} tone={me} onConfirm={() => { setLayout([]); setStep("deploy"); }} />
        )
      )}

      {mySetup && step === "deploy" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button kind="outline" full disabled={submitted} onClick={() => (layout.length ? setLayout(layout.slice(0, -1)) : setStep("roster"))}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="rotateL" s={15} /> {layout.length ? L("Annulla", "Undo") : L("Compagnia", "Company")}</span>
          </Button>
          <Button kind="solid" full tone={me} disabled={layout.length !== draft.length || submitted} onClick={submitSetup}>
            {submitted ? L("In attesa…", "Waiting…") : layout.length === draft.length ? L("Schiera", "Deploy") : `${L("Piazza", "Place")} ${draft.length - layout.length}`}
          </Button>
        </div>
      )}

      {gs.phase === "battle" && canPlay && sel && (
        isMage && blast && blast.a ? (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button kind="outline" full onClick={() => setBlast(null)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="rotateL" s={15} /> {L("Annulla mira", "Cancel aim")}</span>
            </Button>
            <Button kind="solid" full tone={me} disabled={!blast.b} onClick={fireBlast}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="spark" s={15} /> {blast.b ? L("Lancia", "Cast") : L("Scegli la 2ª casella", "Pick the 2nd hex")}</span>
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {dest ? (
              <Button kind="outline" full onClick={() => setDest(null)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="rotateL" s={15} /> {L("Annulla mossa", "Undo move")}</span>
              </Button>
            ) : (
              <Button kind="outline" full onClick={() => { setSel(null); setDest(null); setBlast(null); }}>
                {L("Deseleziona", "Deselect")}
              </Button>
            )}
            <Button kind="solid" full tone={me} onClick={endUnit}>
              {healing ? L("Curati qui", "Heal here") : dest ? L("Fermati qui", "Stop here") : L("Passa", "Pass")}
            </Button>
          </div>
        )
      )}

      <Micro style={{ textAlign: "center", marginTop: 12 }}>
        {who(room, "A")} {gs.order.filter((id) => gs.units[id].owner === "A").length} · {who(room, "B")} {gs.order.filter((id) => gs.units[id].owner === "B").length} {L("pedine","pieces")} · {L("mani","hands")} {gs.tally.A}–{gs.tally.B}
      </Micro>
    </div>
  );
}

/* ── straccia camicia ── */
function Camicia({ room, gs, seat, mine, slamId, commit, showScores }) {
  const opp = other(seat);
  const shown = gs.center.slice(-5);
  const attack = room.opts.intl ? "A 4 · R 3 · C 2 · F 1" : L("A 1 · 2 due · 3 tre", "A 1 · 2 two · 3 three");
  const flip = () => {
    if (mine && !gs.done) commit(camiciaFlip(gs, seat, room.opts));
  };
  const label = gs.done ? L("FINE","DONE") : !mine ? L("ASPETTA","WAIT") : gs.debt > 0 ? `${L("PAGA","PAY")} ${gs.debt}` : L("GIRA","FLIP");

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
                ? `${who(room, gs.win)} ${L("prende tutto", "takes it all")}`
                : L("Bloccati in un ciclo — pareggio", "Stuck in a loop — draw")
              : gs.debt > 0
              ? `${who(room, gs.turn)} ${L("deve", "owes")} ${gs.debt}`
              : `${L("gira", "to play")} ${who(room, gs.turn)}`}
          </div>
          <Micro style={{ marginTop: 5 }}>
            {gs.center.length} {L("in mezzo", "in the middle")} · {attack}
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
        <Micro>{gs.done ? L("mano finita","hand over") : mine ? L("trascina il mazzo in su per giocare","drag the deck up to play") : L("tocca all’altro","other side to play")}</Micro>
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
  // the trump reveal: both players eye the big briscola and tap; then it tucks
  // under the deck and play begins.
  const revealDone = !gs.reveal || (gs.reveal.A && gs.reveal.B);
  const iRevealed = gs.reveal && gs.reveal[seat];
  const [tucking, setTucking] = useState(false);
  const wasDone = useRef(revealDone);
  useEffect(() => {
    if (!wasDone.current && revealDone) {
      setTucking(true);
      const t = setTimeout(() => setTucking(false), 640);
      wasDone.current = revealDone;
      return () => clearTimeout(t);
    }
    wasDone.current = revealDone;
  }, [revealDone]);
  const confirmReveal = () => {
    if (!iRevealed) commit(briscolaReveal(gs, seat));
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
      {!revealDone && (
        <div onClick={confirmReveal} style={{ position: "fixed", inset: 0, zIndex: 80, background: SCRIM, display: "grid", placeItems: "center", padding: 24, cursor: iRevealed ? "default" : "pointer" }}>
          <div style={{ textAlign: "center" }}>
            <Micro style={{ color: "rgba(255,255,255,0.7)" }}>{L("La briscola", "The trump")}</Micro>
            <div className="pop" style={{ marginTop: 14, display: "inline-block" }}>
              <Card card={gs.briscola} size="xl" rot={-2} />
            </div>
            <div style={{ marginTop: 18, fontFamily: BRAND, fontWeight: 600, fontSize: 15, color: "#fff" }}>
              {iRevealed ? `${L("Aspetta", "Waiting for")} ${who(room, opp)}…` : L("Tocca per confermare", "Tap to confirm")}
            </div>
          </div>
        </div>
      )}
      {tucking && (
        <div className="bristuck" style={{ position: "fixed", left: "50%", top: "44%", zIndex: 79, pointerEvents: "none" }}>
          <Card card={gs.briscola} size="xl" rot={0} />
        </div>
      )}
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
          {gs.deck.length > 0 && (
            <div style={{ width: 40, textAlign: "center", fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T.ink60 }}>{gs.deck.length}</div>
          )}
        </div>

        {/* the trick */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {gs.lead ? (
            <Card card={gs.lead.card} size="lg" rot={-3} slam={slamId === gs.lead.card.id} enter />
          ) : played && slamId === played.id ? (
            <Card card={played} size="lg" rot={3} slam />
          ) : (
            <Micro>{mine ? L("apri la mano","lead a card") : `${who(room, gs.turn)} ${L("gioca","plays")}`}</Micro>
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
          {gs.done ? L("mano finita","hand over") : mine ? (gs.lead ? L("rispondi","respond") : L("gioca","play")) : L("aspetta","wait")}
        </div>
      </div>

      {/* your hand */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          {nameRow(seat, true)}
          <Micro>{L("briscola","trump")} {suitName(gs.trump, french)}</Micro>
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
          <Micro>{gs.phase === "roll" ? L("lanciate i dadi","roll the dice") : `${who(room, gs.turn)} ${L("apre le puntate","opens the bidding")}`}</Micro>
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
                  {L("Rilancia","Raise")}
                </Button>
                {gs.bid && (
                  <Button kind="line" onClick={() => commit(perudoDoubt(gs, seat))}>
                    {L("Dubito!","Liar!")}
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
        aria-label={`${L("Scheda di", "Sheet for")} ${who(room, opp)}`}
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
        <Sheet title={L("Come si contano i punti","How scoring works")} onClose={() => setShowHelp(false)}>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: T.ink80 || T.ink }}>
            {[
              ["Uno–Sei", L("somma dei dadi di quel numero", "sum of the dice showing that number")],
              ["Bonus", L("+35 se in alto (Uno–Sei) arrivi a 63", "+35 if the upper section (Uno–Sei) reaches 63")],
              ["Tris", L("con almeno 3 dadi uguali, vale la somma di tutti e cinque i dadi (non solo dei tre uguali)", "with 3 or more matching dice, scores all five dice (not just the three)")],
              ["Poker", L("con almeno 4 dadi uguali, vale la somma di tutti e cinque i dadi (non solo dei quattro uguali)", "with 4 or more matching dice, scores all five dice (not just the four)")],
              ["Full", L("25 — tre uguali più due uguali", "25 — three of a kind plus a pair")],
              ["Scala", L("30 — quattro in fila", "30 — four in a row")],
              ["Scalona", L("40 — cinque in fila", "40 — five in a row")],
              ["Cinquina", L("50 — cinque uguali", "50 — five of a kind")],
              ["Chance", L("somma di tutti i dadi, sempre", "sum of all five dice, always")],
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
        <Micro style={{ marginTop: 8, minHeight: 14 }}>{gs.rolled && canRoll ? L("tocca i dadi da tenere", "tap the dice to keep") : ""}</Micro>
        <div style={{ marginTop: 10 }}>
          {mine && !gs.done ? (
            gs.rollsLeft > 0 ? (
              <Button full onClick={tapRoll}>
                {gs.rolled ? `${L("Ritira","Reroll")} · ${gs.rollsLeft} ${L("rimasti","left")}` : L("Lancia i dadi","Roll the dice")}
              </Button>
            ) : (
              <Micro>{L("segna un punteggio qui sotto","score a box below")}</Micro>
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

/* ── diecimila (farkle) ── */
const FARKLE_HELP = [
  ["1", L("un 1 vale 100", "a single 1 is 100")],
  ["5", L("un 5 vale 50", "a single 5 is 50")],
  ["1·1·1", L("tre 1 valgono 1000", "three 1s are 1000")],
  ["2·2·2 … 6·6·6", L("tre uguali: la faccia × 100 (2→200 … 6→600)", "three of a kind: face × 100 (2→200 … 6→600)")],
  ["4·5·6 uguali", L("quattro, cinque o sei uguali raddoppiano il tris (×2, ×4, ×8)", "four, five or six of a kind double the triple (×2, ×4, ×8)")],
  ["1·2·3·4·5·6", L("scala completa: 1500", "full straight: 1500")],
  [L("tre coppie", "three pairs"), L("1500", "1500")],
  ["Farkle", L("un tiro senza punti brucia tutto il turno", "a roll that scores nothing burns the whole turn")],
];
function Farkle({ room, gs, seat, mine, commit }) {
  const opp = other(seat);
  const [sel, setSel] = useState([]); // indices into gs.dice chosen to set aside
  const [showHelp, setShowHelp] = useState(false);
  const rollKey = gs.dice.join(",") + "|" + gs.turn + "|" + (gs.rolled ? 1 : 0);
  useEffect(() => setSel([]), [rollKey]); // a new roll (or handover) clears the pick

  const preview = mine && gs.rolled ? farkleSelectionScore(sel.map((i) => gs.dice[i])) : null;
  const valid = preview != null && preview > 0;
  const wouldBank = gs.turnScore + (valid ? preview : 0);
  const opensOk = !gs.entry || gs.scores[seat] > 0 || wouldBank >= gs.entry;
  const toggle = (i) => {
    if (!mine || !gs.rolled || gs.done) return;
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.concat(i)));
  };

  // farkle bust + hot-dice flashes, shared off the anim so both screens react
  const [flash, setFlash] = useState(null);
  const seen = useRef(null);
  useEffect(() => {
    const a = room?.anim,
      ev = room?.ev;
    if (!a || a.id === seen.current) return;
    seen.current = a.id;
    if (ev?.t === "farkle") setFlash({ id: a.id, kind: "farkle" });
    else if (ev?.t === "roll" && ev.hot) setFlash({ id: a.id, kind: "hot" });
  }, [room?.anim?.id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash?.id]);

  const pct = Math.min(1, gs.scores[seat] / gs.target);
  const oppPct = Math.min(1, gs.scores[opp] / gs.target);

  return (
    <div style={{ paddingBottom: 56 }}>
      {flash && (
        <div style={{ position: "fixed", inset: 0, zIndex: 55, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div key={flash.id} className="scopaflash" style={{ fontFamily: BRAND, fontWeight: 700, fontSize: "clamp(48px, 16vw, 118px)", color: flash.kind === "farkle" ? "#B23A2E" : "#B8862B", letterSpacing: "-0.03em", textShadow: "0 6px 0 rgba(18,18,18,0.1)", whiteSpace: "nowrap" }}>
            {flash.kind === "farkle" ? "Farkle!" : L("Dadi caldi!", "Hot dice!")}
          </div>
        </div>
      )}

      {/* opponent + target progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, opp)}</div>
        <Micro>
          {gs.scores[opp]} / {gs.target}
        </Micro>
      </div>
      <div style={{ height: 4, background: T.line, borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${oppPct * 100}%`, height: "100%", background: TSIDE[opp] }} />
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
        <button onClick={() => setShowHelp(true)} style={{ ...plain, color: T.ink, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Ico n="help" s={15} /> {L("come si conta", "how scoring works")}
        </button>
      </div>
      {showHelp && (
        <Sheet title={L("Come si contano i punti", "How scoring works")} onClose={() => setShowHelp(false)}>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: T.ink80 || T.ink }}>
            {FARKLE_HELP.map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 10, padding: "4px 0" }}>
                <span style={{ fontWeight: 700, minWidth: 96, color: T.ink }}>{k}</span>
                <span style={{ color: T.ink60 }}>{v}</span>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {/* set-aside dice this turn */}
      {gs.kept.length > 0 && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Micro style={{ marginBottom: 6 }}>{L("messi da parte", "set aside")}</Micro>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {gs.kept.map((d, i) => (
              <Die key={i} v={d} size={34} hi />
            ))}
          </div>
        </div>
      )}

      {/* the live roll */}
      <div style={{ margin: "18px 0 6px", textAlign: "center" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minHeight: 58, alignItems: "flex-end", flexWrap: "wrap" }}>
          {gs.rolled && gs.dice.length ? (
            gs.dice.map((d, i) => {
              const on = sel.includes(i);
              return (
                <div key={i} style={{ transform: on ? "translateY(-7px)" : "none", transition: "transform 150ms ease" }}>
                  <Die v={d} size={48} hi={on} roll={!!d} onClick={mine ? () => toggle(i) : undefined} />
                </div>
              );
            })
          ) : (
            <Micro>{gs.farkle ? L("niente punti — turno perso", "no points — turn lost") : L("sei dadi pronti", "six dice ready")}</Micro>
          )}
        </div>
      </div>

      {/* this turn's running pot */}
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <span style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 20, color: T.ink }}>{gs.turnScore}</span>
        <Micro style={{ display: "inline", marginLeft: 8 }}>
          {L("in gioco", "in play")}
          {valid ? ` · +${preview}` : ""}
        </Micro>
      </div>

      {/* controls */}
      <div style={{ marginTop: 12 }}>
        {!mine || gs.done ? (
          <Micro style={{ textAlign: "center", display: "block" }}>{gs.done ? "" : `${L("tocca a", "over to")} ${who(room, opp)}`}</Micro>
        ) : !gs.rolled ? (
          <Button full onClick={() => commit(farkleRoll(gs, seat))}>
            {L("Lancia i dadi", "Roll the dice")}
          </Button>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <Button full kind="line" disabled={!valid} onClick={() => valid && commit(farkleRollOn(gs, seat, sel))}>
                {L("Rilancia", "Roll on")}
              </Button>
              <Button full disabled={!valid || !opensOk} onClick={() => valid && opensOk && commit(farkleBank(gs, seat, sel))}>
                {L("Incassa", "Bank")} {wouldBank}
              </Button>
            </div>
            <Micro style={{ textAlign: "center", marginTop: 8, minHeight: 14 }}>
              {!sel.length
                ? L("scegli i dadi che valgono", "pick the dice that score")
                : !valid
                ? L("selezione non valida", "that pick doesn’t score")
                : !opensOk
                ? L("servono 500 per aprire", "you need 500 to open")
                : ""}
            </Micro>
          </>
        )}
      </div>

      {/* your score */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14 }}>{who(room, seat)}</div>
        <Micro>
          {gs.scores[seat]} / {gs.target}
        </Micro>
      </div>
      <div style={{ height: 4, background: T.line, borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: TSIDE[seat] }} />
      </div>
      {gs.trigger != null && !gs.done && (
        <Micro style={{ textAlign: "center", display: "block", marginTop: 10, color: "#B8862B" }}>
          {gs.trigger === seat
            ? L("Sei al traguardo — un ultimo giro all’altro", "You hit the target — one last turn for the other")
            : L("Ultimo giro: supera il punteggio per vincere", "Last turn: beat the score to win")}
        </Micro>
      )}
    </div>
  );
}

/* ── bestiario (onitama) ── */
// A move card as a little 5×5 diagram: the centre is the piece, the tinted cells
// are where it may step. Enemy cards are drawn rotated 180° so their reach points
// down the board, the way it will actually fall.
function BestCard({ card, enemy, tint, selected, dim, onClick, size = 82 }) {
  const filled = new Set();
  for (const m of card.moves) {
    const rr = enemy ? 2 + m.f : 2 - m.f;
    const cc = enemy ? 2 - m.s : 2 + m.s;
    filled.add(rr * 5 + cc);
  }
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{ ...plain, cursor: onClick ? "pointer" : "default", opacity: dim ? 0.5 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6, borderRadius: 10, border: `1.5px solid ${selected ? "#B8862B" : "transparent"}`, background: selected ? "rgba(184,134,43,0.08)" : "transparent", WebkitTapHighlightColor: "transparent" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 1.5, width: size, height: size }}>
        {Array.from({ length: 25 }, (_, i) => (
          <div key={i} style={{ borderRadius: 2, background: i === 12 ? T.ink : filled.has(i) ? tint : "rgba(18,18,18,0.07)" }} />
        ))}
      </div>
      <span style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 12, color: T.ink }}>{bestCardName(card)}</span>
    </button>
  );
}
function Bestiario({ room, gs, seat, mine, commit }) {
  const opp = other(seat);
  const [selCard, setSelCard] = useState(null);
  const [selFrom, setSelFrom] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const me = TSIDE[seat],
    foe = TSIDE[opp];

  // the pick resets whenever the position moves on (a move landed, or handover)
  const turnKey = gs.turn + "|" + gs.cards.spare + "|" + (gs.last ? `${gs.last.from}-${gs.last.to}` : "x");
  useEffect(() => {
    setSelCard(null);
    setSelFrom(null);
  }, [turnKey]);

  const stuck = mine && !bestAnyMove(gs, seat);
  const dests = selCard != null && selFrom != null ? bestDests(gs, seat, selFrom, selCard) : [];
  const destSet = new Set(dests);
  const absOf = (sr, sc) => (seat === "A" ? (4 - sr) * 5 + sc : sr * 5 + (4 - sc)); // own side at the bottom

  const tapCell = (abs) => {
    if (!mine) return;
    if (selCard != null && selFrom != null && destSet.has(abs)) {
      commit(bestiarioPlay(gs, seat, selFrom, abs, selCard));
      setSelFrom(null);
      return;
    }
    const p = gs.board[abs];
    setSelFrom(p && p.seat === seat ? (abs === selFrom ? null : abs) : null);
  };
  const tapCard = (cid) => {
    if (!mine) return;
    if (stuck) return commit(bestiarioPass(gs, seat, cid));
    setSelCard(cid === selCard ? null : cid);
  };

  const status = gs.done
    ? ""
    : !mine
    ? `${L("tocca a", "over to")} ${who(room, opp)}`
    : stuck
    ? L("Nessuna mossa — scarta una carta", "No move — discard a card")
    : selCard == null
    ? L("Scegli una carta", "Pick a card")
    : selFrom == null
    ? L("Scegli una pedina", "Pick a piece")
    : L("Tocca dove muovere", "Tap where to move");

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* opponent + their cards */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14, color: foe }}>{who(room, opp)}</div>
        <button onClick={() => setShowHelp(true)} style={{ ...plain, color: T.ink, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Ico n="help" s={15} /> {L("come si gioca", "how to play")}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 4 }}>
        {gs.cards[opp].map((cid) => (
          <BestCard key={cid} card={BEST_CARD[cid]} enemy tint={foe} dim={gs.turn === seat} size={62} />
        ))}
      </div>

      {showHelp && (
        <Sheet title={L("Come si gioca", "How to play")} onClose={() => setShowHelp(false)}>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: T.ink80 || T.ink }}>
            <p style={{ margin: "0 0 10px" }}>{L("Ogni giocatore ha un Maestro (con il puntino) e quattro Allievi. Hai due carte-mossa; l’altro ne ha due, e una resta da parte.", "Each player has a Master (the one with the dot) and four Students. You hold two move cards; the other holds two, and one waits aside.")}</p>
            <p style={{ margin: "0 0 10px" }}>{L("Scegli una carta, poi una pedina, poi tocca dove muoverla secondo lo schema. Atterri su un nemico per catturarlo.", "Pick a card, then a piece, then tap where its pattern lets it go. Land on an enemy to capture it.")}</p>
            <p style={{ margin: "0 0 10px" }}>{L("La carta usata passa da parte e tu prendi quella in attesa: le mosse girano di continuo tra i due giocatori.", "The card you use passes aside and you take the waiting one — the moves keep rotating between both players.")}</p>
            <p style={{ margin: 0 }}>{L("Vinci in due modi: catturi il Maestro avversario, oppure porti il tuo Maestro sul tempio nemico (la casella centrale del suo fondo).", "Win two ways: capture the enemy Master, or walk your own Master onto the enemy temple — the centre square of their back row.")}</p>
          </div>
        </Sheet>
      )}

      {/* the board — your side at the bottom */}
      <div style={{ width: "min(92vw, 400px)", margin: "12px auto", aspectRatio: "1", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gridTemplateRows: "repeat(5,1fr)", border: `1px solid ${T.ink}`, borderRadius: 8, overflow: "hidden", background: T.paper }}>
        {Array.from({ length: 25 }, (_, k) => {
          const sr = (k / 5) | 0,
            sc = k % 5;
          const abs = absOf(sr, sc);
          const p = gs.board[abs];
          const isDest = destSet.has(abs);
          const isSel = selFrom === abs;
          const isTemple = abs === BEST_TEMPLE.A || abs === BEST_TEMPLE.B;
          const templeTint = abs === BEST_TEMPLE[seat] ? me : foe;
          const lastHit = gs.last && !gs.last.pass && (gs.last.from === abs || gs.last.to === abs);
          const checker = (sr + sc) % 2 === 0 ? "transparent" : "rgba(18,18,18,0.035)";
          return (
            <div
              key={k}
              onClick={() => tapCell(abs)}
              style={{ position: "relative", borderRight: sc < 4 ? `1px solid ${T.line}` : "none", borderBottom: sr < 4 ? `1px solid ${T.line}` : "none", background: lastHit ? "rgba(184,134,43,0.12)" : checker, cursor: mine ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
            >
              {isTemple && <div style={{ position: "absolute", inset: "28%", border: `1.5px solid ${templeTint}`, opacity: 0.4, transform: "rotate(45deg)", borderRadius: 2 }} />}
              {p && (
                <div style={{ position: "absolute", inset: "16%", borderRadius: "50%", background: TSIDE[p.seat], boxShadow: isDest ? "0 0 0 3px #B8862B" : "0 1px 3px rgba(18,18,18,0.3)", border: isSel ? "2.5px solid #B8862B" : "none", display: "grid", placeItems: "center", transition: "box-shadow 120ms ease" }}>
                  {p.master && <span style={{ width: "36%", height: "36%", borderRadius: "50%", background: "#fff" }} />}
                </div>
              )}
              {isDest && !p && <div style={{ position: "absolute", inset: "40%", borderRadius: "50%", background: "rgba(184,134,43,0.8)" }} />}
            </div>
          );
        })}
      </div>

      {/* status */}
      <div style={{ textAlign: "center", minHeight: 20 }}>
        <div key={status} className="swap" style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 15, color: mine ? T.ink : T.ink60 }}>{status}</div>
      </div>

      {/* your cards + the spare */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 8, marginTop: 8 }}>
        {gs.cards[seat].map((cid) => (
          <BestCard key={cid} card={BEST_CARD[cid]} tint={me} selected={selCard === cid} dim={!mine} onClick={mine ? () => tapCard(cid) : undefined} size={84} />
        ))}
        <div style={{ width: 1, alignSelf: "stretch", background: T.line, margin: "6px 2px" }} />
        <BestCard card={BEST_CARD[gs.cards.spare]} tint="rgba(18,18,18,0.35)" dim size={58} />
      </div>
      <Micro style={{ textAlign: "center", display: "block", marginTop: 2 }}>{L("in attesa", "waiting")}</Micro>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: me }} />
        <span style={{ fontFamily: BRAND, fontWeight: 600, fontSize: 14, color: me }}>{who(room, seat)}</span>
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
// A meld laid on the table, arranged for reading: a set by suit, a run in
// ascending rank with any joker sitting in the exact slot it fills.
function s40SortMeld(cards) {
  const info = analyzeMeld(cards);
  if (!info.ok) return cards;
  const jokers = cards.filter((c) => c.joker);
  const nats = cards.filter((c) => !c.joker);
  if (info.kind === "set") return [...nats.slice().sort((a, b) => S40_SUIT_ORD[a.s] - S40_SUIT_ORD[b.s]), ...jokers];
  const free = jokers.filter((c) => !c.rep); // fills a gap; ≤1 per meld
  const fixed = [...nats, ...jokers.filter((c) => c.rep)]; // cards with a definite rank
  const rankOf = (c, aceHigh) => {
    const v = c.joker ? c.rep.v : c.v;
    return v === 1 ? (aceHigh ? 14 : 1) : v;
  };
  for (const aceHigh of [false, true]) {
    const ranks = fixed.map((c) => rankOf(c, aceHigh)).sort((a, b) => a - b);
    if (new Set(ranks).size !== ranks.length) continue;
    const len = cards.length;
    for (let lo = ranks[ranks.length - 1] - len + 1; lo <= ranks[0]; lo++) {
      const hi = lo + len - 1;
      if (lo < 1 || hi > 14 || ranks[0] < lo || ranks[ranks.length - 1] > hi) continue;
      const byRank = {};
      for (const c of fixed) byRank[rankOf(c, aceHigh)] = c;
      const out = [];
      let fi = 0,
        ok = true;
      for (let r = lo; r <= hi; r++) {
        if (byRank[r]) out.push(byRank[r]);
        else if (fi < free.length) out.push(free[fi++]);
        else {
          ok = false;
          break;
        }
      }
      if (ok && out.length === cards.length && fi === free.length) return out;
    }
  }
  return cards;
}
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
    if (source === "discard" && !canTakeDiscard) return setHint(L("Prendi lo scarto solo se lo usi subito — in un tris, una scala o l’apertura.","Take the discard only to use it now — in a set, a run or your opening."));
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
  const [sortMode, setSortMode] = useState("seme"); // "seme" | "numero" | null(=manual); active → the hand stays sorted and drawn cards slot in
  const [dragId, setDragId] = useState(null);
  const drag = useRef(null);
  const handRow = useRef(null);
  const handKey = hand.map((c) => c.id).join(",");
  const cardOf = (id) => hand.find((c) => c.id === id);
  useEffect(() => {
    const ids = hand.map((c) => c.id);
    setOrder((prev) => {
      // an active sort keeps the whole hand ordered — a freshly drawn card lands
      // in its right place on its own
      if (sortMode) {
        const sorted = s40Sorted(hand, sortMode);
        return sorted.join(",") === prev.join(",") ? prev : sorted;
      }
      const keep = prev.filter((id) => ids.includes(id));
      const add = ids.filter((id) => !keep.includes(id));
      if (keep.length === prev.length && add.length === 0) return prev;
      if (keep.length === 0) return s40Sorted(hand); // first layout: fully sorted
      // manual arrangement: a drawn card still slots into place without disturbing the rest
      const next = keep.slice();
      for (const id of add) {
        const c = cardOf(id);
        let i = 0;
        while (i < next.length && !s40Before(c, cardOf(next[i]))) i++;
        next.splice(i, 0, id);
      }
      return next;
    });
  }, [handKey, sortMode]);
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
      setSortMode(null); // hand-arranging by drag turns the auto-sort off
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
  const notAMeld = () => setHint(sel.length < 3 ? L("Seleziona almeno 3 carte per un tris o una scala.","Select at least 3 cards for a set or run.") : L("Quelle carte non formano un tris né una scala.","Those cards don't form a set or a run."));
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
  const doApri = () => (stagedTotal >= 40 ? commit(s40Open(gs, seat, staged)) : setHint(`${L("Ti servono 40 punti per aprire — sei a","You need 40 points to open — you're at")} ${stagedTotal}.`));
  const doScarta = () =>
    sel.length === 1 ? commit(s40Discard(gs, seat, sel[0])) : setHint(sel.length === 0 ? L("Tocca una carta, poi Scarta per finire il turno.","Tap a card, then Discard to end your turn.") : L("Per scartare seleziona una sola carta.","Select just one card to discard."));

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
      {s40SortMeld(m.cards).map((c, i) => (
        <div key={c.id} style={{ marginLeft: i ? -14 : 0, position: "relative", borderRadius: 6, boxShadow: c.joker ? "0 0 0 2px #B8862B" : "none" }}>
          <S40Card card={c} w={30} h={44} />
          {c.joker && (
            <span title={L("jolly — sostituibile con la carta che rappresenta","joker — swappable for the card it stands for")} style={{ position: "absolute", top: -6, right: -6, width: 15, height: 15, borderRadius: "50%", background: "#B8862B", color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: "15px", textAlign: "center", boxShadow: "0 1px 2px rgba(18,18,18,0.35)" }}>⇄</span>
          )}
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
          <Micro>{L("Le tue combinazioni","Your melds")}{target ? L(" · tocca per attaccare"," · tap to lay off") : ""}</Micro>
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
          {["numero", "seme"].map((m) => {
            const on = sortMode === m;
            return (
              <button
                key={m}
                onClick={() => setSortMode((cur) => (cur === m ? null : m))}
                title={on ? L("attivo — le carte pescate si ordinano da sole", "on — drawn cards sort themselves") : L("ordina e tieni ordinato", "sort and keep sorted")}
                style={{ ...plain, cursor: "pointer", color: on ? T.bg : T.ink, background: on ? T.ink : "transparent", border: `1px solid ${on ? T.ink : T.line}`, borderRadius: 999, padding: "2px 9px", fontFamily: BRAND, fontWeight: 600, fontSize: 12, WebkitTapHighlightColor: "transparent" }}
              >
                {m}
              </button>
            );
          })}
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
          {!mine && <Micro style={{ textAlign: "center" }}>{who(room, opp)} {L("gioca","to play")}</Micro>}
          {mine && gs.phase === "draw" && (
            <Micro style={{ textAlign: "center", color: hint ? T.ink : undefined }}>{hint || (canTakeDiscard ? L("pesca dal mazzo, o prendi lo scarto per usarlo subito","draw from stock, or take the discard to use it now") : L("pesca dal mazzo","draw from stock"))}</Micro>
          )}
          {mine && gs.phase === "meld" && jokerAsk && (
            <div>
              <Micro style={{ textAlign: "center" }}>{L("Il jolly rappresenta:","The joker stands for:")}</Micro>
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
                  {L("annulla","cancel")}
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
                    ? `${selMeld.kind === "set" ? L("tris","set") : L("scala","run")} ${L("valida ·","valid ·")} ${selMeld.value} ${L("punti","pts")}`
                    : !opened && staged.length > 0
                    ? `${L("apertura","opening")} ${stagedTotal}/40${stagedTotal < 40 ? L(" — aggiungi combinazioni"," — add more melds") : L(" — puoi aprire"," — you can open")}`
                    : opened && sel.length === 1
                    ? L("scarta, o tocca una combinazione per attaccare","discard, or tap a meld to lay off")
                    : opened
                    ? L("cala una combinazione, o scarta una carta","lay a meld, or discard a card")
                    : L("componi almeno 40 punti per aprire","build at least 40 points to open")}
                </Micro>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {opened ? (
                  <Button full soft={!selMeld.ok} onClick={doCala}>
                    {L("Cala","Lay")}
                  </Button>
                ) : (
                  <>
                    <Button kind="line" soft={!selMeld.ok} onClick={doAggiungi}>
                      {L("Aggiungi","Add")}
                    </Button>
                    <Button full soft={stagedTotal < 40} onClick={doApri}>
                      {L("Apri","Open")} {staged.length ? `· ${stagedTotal}` : ""}
                    </Button>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", justifyContent: "space-between" }}>
                <Button kind="line" full soft={sel.length !== 1} onClick={doScarta}>
                  {L("Scarta","Discard")}
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
function Prepare({ room, seat, shuffleTap, shuffleDone, cutAndDeal, liveCut }) {
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
  const [cutAt, setCutAt] = useState(() => Math.max(2, Math.round((prep.deck.length || 40) / 2)));
  const barRef = useRef(null);
  const drag = useRef(false);
  const fromX = (clientX) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const N = prep.deck.length; // 40 for the normal deck, 106 for Scala
    const v = Math.max(2, Math.min(N - 2, Math.round(frac * N)));
    setCutAt(v);
    liveCut && liveCut(v); // let the dealer watch the cut move in real time
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

  // the deck spread with a cut marker — interactive for the cutter, a live
  // read-only mirror (the marker glides) for the dealer watching.
  const cutSpread = (at, live) => (
    <div
      ref={live ? null : barRef}
      onTouchStart={live ? undefined : onDown}
      onTouchMove={live ? undefined : onMove}
      onTouchEnd={live ? undefined : onUp}
      onMouseDown={live ? undefined : onDown}
      onMouseMove={live ? undefined : onMove}
      onMouseUp={live ? undefined : onUp}
      onMouseLeave={live ? undefined : onUp}
      style={{ position: "relative", height: 108, margin: "24px 0 10px", touchAction: live ? "auto" : "none", userSelect: "none", WebkitUserSelect: "none", cursor: live ? "default" : "ew-resize" }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 22, bottom: 22, display: "flex", gap: 1 }}>
        {Array.from({ length: 40 }, (_, i) => {
          const fr = at / (prep.deck.length || 40); // where the cut sits, 0..1
          const lit = i / 40 < fr;
          return <div key={i} style={{ flex: 1, borderRadius: 2, background: lit ? T.ink : "#4a4a48", boxShadow: i === Math.round(fr * 40) - 1 ? `2px 0 0 ${T.bg}` : "none", transition: live ? "background 90ms ease" : "none" }} />;
        })}
      </div>
      <div style={{ position: "absolute", top: 6, bottom: 6, left: `calc(${(at / (prep.deck.length || 40)) * 100}% - 1px)`, width: 2, background: "#B8862B", transition: live ? "left 90ms ease" : "none" }} />
      <div style={{ position: "absolute", top: -4, left: `calc(${(at / (prep.deck.length || 40)) * 100}% - 8px)`, color: "#B8862B", fontSize: 16, transition: live ? "left 90ms ease" : "none" }}>▼</div>
    </div>
  );

  if (step === "shuffle" && !amDealer) return wait(`${dealerName} ${L("mescola", "is shuffling")}`, `${prep.shuffles} ${L("mescolate", "shuffles")}`);
  if (step === "cut" && amDealer) {
    const at = prep.cutAt ?? 20;
    return (
      <div className="fade" style={{ textAlign: "center", paddingTop: 8 }}>
        <Micro>{cutterName} {L("taglia", "cuts")}</Micro>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 300 }}>{L("Guarda dove sta tagliando il mazzo…", "Watch where they cut the deck…")}</p>
        {cutSpread(at, true)}
        <Micro>
          {at} {L("sopra", "above")} · {prep.deck.length - at} {L("sotto", "below")}
        </Micro>
        <div style={{ marginTop: 22 }}>
          <Micro>{L("un attimo…", "one moment…")}</Micro>
        </div>
      </div>
    );
  }

  if (step === "shuffle")
    return (
      <div className="fade" style={{ textAlign: "center", paddingTop: 8 }}>
        <Micro>{L("Mescola", "Shuffle")}</Micro>
        <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 300 }}>
          {L("Tocca il mazzo per mescolare — o tienilo premuto per mescolare veloce. Il ritmo delle tue dita decide le carte.", "Tap the deck to shuffle — or hold to shuffle fast. Your fingers' rhythm decides the cards.")}
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
        <Micro style={{ marginTop: 2 }}>{L("mescolate", "shuffles")}</Micro>
        <div style={{ marginTop: 22 }}>
          <Button full disabled={prep.shuffles < 1} onClick={shuffleDone}>
            {prep.shuffles < 1 ? L("Tocca per mescolare", "Tap to shuffle") : `${L("Passa il taglio a", "Pass the cut to")} ${cutterName}`}
          </Button>
        </div>
      </div>
    );

  // cut, shown to the non-dealer
  return (
    <div className="fade" style={{ textAlign: "center", paddingTop: 8 }}>
      <Micro>{L("Taglia", "Cut")}</Micro>
      <p style={{ color: T.ink60, fontSize: 14, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 300 }}>
        {L("Trascina lungo il mazzo per scegliere dove tagliare, poi conferma.", "Drag along the deck to choose where to cut, then confirm.")}
      </p>
      {cutSpread(cutAt, false)}
      <Micro>
        {cutAt} {L("sopra", "above")} · {prep.deck.length - cutAt} {L("sotto", "below")}
      </Micro>
      <div style={{ marginTop: 22 }}>
        <Button full onClick={() => cutAndDeal(cutAt)}>
          {L("Taglia e distribuisci", "Cut and deal")}
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
                  <Micro style={{ minWidth: 54 }}>{L("Scope", "Sweeps")} {who(room, s)}</Micro>
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
  if ((room.game === "ruba" || room.game === "briscola" || room.game === "yahtzee" || room.game === "diecimila") && gs.summary)
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: BRAND }}>
          {gs.summary.a} <span style={{ color: T.ink30 }}>—</span> {gs.summary.b}
        </div>
        <Micro style={{ marginTop: 4 }}>
          {who(room, "A")} · {who(room, "B")}
          {room.game === "briscola" ? L(" · punti su 120", " · points out of 120") : room.game === "yahtzee" || room.game === "diecimila" ? L(" · punti totali", " · total points") : ""} · {L("mani", "hands")} {gs.tally.A}–{gs.tally.B}
        </Micro>
      </div>
    );
  if (room.game === "scala" && gs.penalty != null)
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18 }}>{gs.penalty} {L("di penalità", "penalty")}</div>
        <Micro style={{ marginTop: 4 }}>
          {L("a", "to")} {who(room, other(gs.win))} · {L("mani", "hands")} {gs.tally.A}–{gs.tally.B}
        </Micro>
      </div>
    );
  if (room.game === "condottieri")
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {gs.how === "castle" ? (
            <>{L("Castello espugnato", "Castle taken")} <Ico n="castle" s={16} /></>
          ) : gs.how === "flags" ? (
            <>{L("Stendardi conquistati", "Banners taken")} <Ico n="flag" s={16} /></>
          ) : gs.how === "timeout" ? (
            L("Mosse esaurite", "Out of moves")
          ) : gs.win ? (
            <>{L("Campo sterminato", "Army wiped out")} <Ico n="sword" s={16} /></>
          ) : (
            L("Pareggio", "Draw")
          )}
        </div>
        <Micro style={{ marginTop: 4 }}>{L("battaglie", "battles")} {gs.tally.A}–{gs.tally.B}</Micro>
      </div>
    );
  if (room.game === "bestiario")
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: BRAND, fontWeight: 700, fontSize: 18 }}>
          {gs.how === "temple" ? L("Tempio raggiunto", "Temple reached") : L("Maestro catturato", "Master captured")}
        </div>
        <Micro style={{ marginTop: 4 }}>{L("partite", "games")} {gs.tally.A}–{gs.tally.B}</Micro>
      </div>
    );
  return (
    <Micro style={{ textAlign: "center" }}>
      {L("mani", "hands")} {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
    </Micro>
  );
}
