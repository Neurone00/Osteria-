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
};

/* ── scopa ─────────────────────────────────────────────────── */
function dealScopa(dealer, scores, o) {
  let deck, table;
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
  let note = `cala il ${lbl(card.v)} di ${SUIT[card.s].name.toLowerCase()}`;
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
      note = `svuota il tavolo — scopa`;
    } else {
      kind = "take";
      note = `prende ${got.map((c) => lbl(c.v)).join("+")} con il ${lbl(card.v)}`;
    }
  } else if (o.acepile && card.v === 1) {
    // House rule: an asso played with nothing to capture is banked straight to
    // your pile instead of being laid on the table. It counts as a take (never
    // a scopa — the table is untouched), so the last-taker credit follows too.
    g.piles[seat].push(card);
    g.last = seat;
    kind = "take";
    note = `incassa l’asso`;
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
  return { g, kind, note, card };
}

/* ── rubamazzo ─────────────────────────────────────────────── */
function dealRuba(dealer, tally) {
  const deck = shuffle(makeDeck());
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
  let note = `cala il ${lbl(card.v)} di ${SUIT[card.s].name.toLowerCase()}`;
  if (opt && opt.type === "steal") {
    const pile = g.piles[other(seat)];
    kind = "scopa";
    note = `ruba un mazzo di ${pile.length} con il ${lbl(card.v)}`;
    g.piles[seat] = [...g.piles[seat], ...pile, card];
    g.piles[other(seat)] = [];
    g.last = seat;
  } else if (opt && opt.type === "table") {
    const got = g.table.filter((c) => opt.ids.includes(c.id));
    g.table = g.table.filter((c) => !opt.ids.includes(c.id));
    g.piles[seat].push(...got, card);
    g.last = seat;
    kind = "take";
    note = `prende ${got.length} con il ${lbl(card.v)}`;
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
  return { g, kind, note, card };
}

/* ── straccia camicia ──────────────────────────────────────── */
const demand = (v, intl) => (intl ? { 1: 4, 10: 3, 9: 2, 8: 1 }[v] || 0 : { 1: 1, 2: 2, 3: 3 }[v] || 0);

function dealCamicia(tally) {
  const d = shuffle(makeDeck());
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
  let note = `gira il ${lbl(card.v)}`;
  if (d > 0) {
    g.owed = seat;
    g.debt = d;
    g.turn = other(seat);
    kind = "take";
    note = `gira il ${lbl(card.v)} — ${d} da pagare`;
  } else if (g.debt > 0) {
    g.debt -= 1;
    if (g.debt === 0) {
      const n = g.center.length;
      g.decks[g.owed].push(...g.center);
      g.center = [];
      g.turn = g.owed;
      kind = "scopa";
      note = `paga l’ultima — ${n} carte cambiano mano`;
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
  return { g, kind, note, card };
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

/* ═══════════════════════════ marks ═══════════════════════════ */
/* Card face is a per-device choice, not a table rule: each player sees the deck
   they picked. false → Napoletane (Italian suits, A/F/C/R); true → Francesi
   (French suits ♦♥♠♣, A/J/Q/K). Values and scoring never change. */
const SuitCtx = createContext(false);
const FR_SUIT = { D: { g: "♦", c: "#B23A2E" }, C: { g: "♥", c: "#B23A2E" }, S: { g: "♠", c: "#15181C" }, B: { g: "♣", c: "#15181C" } };
const FR_RANK = { 1: "A", 8: "J", 9: "Q", 10: "K" };
const VS_TEXT = String.fromCharCode(0xfe0e); // force text (not emoji) rendering of ♦♥♠♣
const faceLbl = (v, french) => (french ? FR_RANK[v] || String(v) : lbl(v));

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
        borderRadius: 4,
        boxShadow: `0 ${dim ? 1 : 2}px ${dim ? 3 : 7}px rgba(18,18,18,${dim ? 0.06 : 0.13})`,
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
        borderRadius: 4,
        background: T.ink,
        boxShadow: stack ? `2px 2px 0 ${T.bgDeep}, 3px 3px 0 ${T.ink}` : "0 1px 3px rgba(18,18,18,0.15)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div style={{ position: "absolute", inset: 5, border: `1px solid rgba(255,255,255,0.32)`, borderRadius: 2 }} />
    </div>
  );
}

function Ghost({ size = "sm" }) {
  const [w, h] = SZ[size];
  return <div style={{ width: w, height: h, border: `1px dashed ${T.ink30}`, borderRadius: 4, flexShrink: 0 }} />;
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
              borderRadius: 4,
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
 0%{transform:translate(var(--dx,0),-140px) rotate(calc(var(--r) * 3)) scale(1.9);opacity:0}
 46%{transform:translate(0,6px) rotate(var(--r)) scale(1.04);opacity:1}
 62%{transform:translate(0,0) rotate(var(--r)) scale(0.985)}
 78%{transform:translate(0,-2px) rotate(var(--r)) scale(1.006)}
 100%{transform:translate(0,0) rotate(var(--r)) scale(1)}
}
.slam{animation:slamIn 420ms cubic-bezier(.16,.9,.3,1) both;z-index:3}
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
@media (prefers-reduced-motion:reduce){.slam,.jolt,.fade,.deal,.turn,.swap{animation:none!important}}
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
  const booted = useRef(false);
  useEffect(() => {
    (async () => {
      const p = await loadPrefs();
      if (!p) return;
      if (typeof p.french === "boolean") setFrench(p.french);
      if (p.rules && typeof p.rules === "object") setSavedRules(p.rules);
      if (typeof p.name === "string") setName(p.name);
    })();
  }, []);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    savePrefs({ french, rules: savedRules, name });
  }, [french, savedRules, name]);
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
      />
    </SuitCtx.Provider>
  );
}

function Game({ french, setFrench, savedRules, setGameRules, name, setName }) {
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
      gs: null,
      log: [],
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

  const joinTable = async () => {
    const code = codeIn.trim().toUpperCase();
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
    const log = [`${who(room, seat)} ${res.note}`, ...room.log].slice(0, 3);
    publish({ ...room, gs: res.g, log, anim: { id: uid(), kind: res.kind, card: res.card?.id, seat } });
  };

  // The host picks the game and its house rules in the lobby, before anything is
  // dealt; both are synced so the guest sees the table being set. Dealing just
  // flips the room to play with whatever is already staged in room.game/opts.
  const pickGame = (game) => publish({ ...room, game, opts: { ...GAMES[game].def, ...(savedRules[game] || {}) } });
  const start = () => publish({ ...room, status: "play", gs: newGame(room.game, room.opts), log: [], anim: null });

  const newGame = (game, o, prev) =>
    game === "scopa"
      ? dealScopa(prev ? other(prev.dealer) : "A", prev ? prev.scores : null, o)
      : game === "ruba"
      ? dealRuba(prev ? other(prev.dealer) : "A", prev ? prev.tally : null)
      : dealCamicia(prev ? prev.tally : null);

  const again = () => {
    const g = room.gs;
    const fresh = room.game === "scopa" && g.matchDone ? newGame("scopa", room.opts) : newGame(room.game, room.opts, g);
    publish({ ...room, gs: fresh, log: [], anim: null });
  };

  const setOpt = (k, val) => {
    const opts = { ...room.opts, [k]: val };
    publish({ ...room, opts });
    setGameRules(room.game, opts); // remember this game's rules for next time
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
          <div style={{ display: "flex", justifyContent: "center", gap: 7, marginBottom: 2 }}>
            {["D", "C", "S", "B"].map((s, i) => (
              <Card key={s} card={{ id: s + "x", s, v: [1, 7, 10, 3][i] }} size="sm" rot={(i - 1.5) * 8} />
            ))}
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
              onChange={(e) => setName(e.target.value)}
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
              <Button kind="line" onClick={joinTable}>
                Entra
              </Button>
            </div>
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

          <Rule />

          <Micro>Gioco</Micro>
          <Segmented
            options={Object.entries(GAMES).map(([k, gm]) => ({ v: k, label: gm.name }))}
            value={room.game}
            onPick={host ? pickGame : null}
            style={{ marginTop: 8 }}
          />
          <p style={{ color: T.ink60, fontSize: 13, lineHeight: 1.45, margin: "12px 0 0" }}>{g.line}</p>

          {g.opts.length > 0 && (
            <>
              <Micro style={{ marginTop: 20 }}>Regole della casa{host ? "" : " · le sceglie l’host"}</Micro>
              <RuleChips conf={g} opts={room.opts} setOpt={host ? setOpt : null} />
            </>
          )}

          <Micro style={{ marginTop: 20 }}>Carte · sul tuo telefono</Micro>
          <FaceToggle french={french} setFrench={setFrench} />

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

  /* ═════════ table ═════════ */
  const gs = room.gs;
  const mine = gs.turn === seat && !gs.done;
  const conf = GAMES[room.game];

  return (
    <Frame jolt={jolt}>
      <Head room={room} link={link} onLeave={leave} sound={sound} setSound={setSound} title={conf.name} />

      {room.game === "camicia" ? (
        <Camicia room={room} gs={gs} seat={seat} mine={mine} slamId={slamId} commit={commit} />
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
        />
      )}

      {room.log[0] && (
        <p style={{ color: T.ink60, fontSize: 12, textAlign: "center", marginTop: 14, minHeight: 16 }}>{room.log[0]}</p>
      )}

      {gs.done && (
        <div className="fade" style={{ borderTop: `1px solid ${T.line}`, marginTop: 14, paddingTop: 14 }}>
          <Summary room={room} gs={gs} />
          {seat === "A" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Button full onClick={again}>
                {room.game === "scopa" && !gs.matchDone ? "Prossima mano" : "Gioca ancora"}
              </Button>
              <Button kind="line" onClick={() => publish({ ...room, status: "lobby", gs: null, log: [] })}>
                Giochi
              </Button>
            </div>
          ) : (
            <Micro style={{ marginTop: 12 }}>distribuisce {room.names.A}</Micro>
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

/* ── scopa / rubamazzo board ── */
function Board({ room, gs, seat, opp, mine, slamId, pick, setPick, commit }) {
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
          <div style={{ fontSize: 14, fontWeight: 600 }}>{who(room, opp)}</div>
          <Micro style={{ marginTop: 2 }}>
            {tally[opp]} {unit}
            {isScopa && gs.scope[opp] ? ` · ${gs.scope[opp]} scopa` : ""}
          </Micro>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
        <PileView room={room} gs={gs} seat={opp} label="sua pila" faceUp={!isScopa} slamId={slamId} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {taken && <Card card={taken} size="sm" rot={0} slam={slamId === taken.id} />}
          <div className={!gs.done && mine ? "turn" : ""}>
            <Micro style={{ textAlign: "center", color: !gs.done && mine ? T.ink : T.ink60 }}>
              {gs.done ? "mano finita" : mine ? "tocca a te" : "aspetta"}
            </Micro>
          </div>
        </div>
        <PileView room={room} gs={gs} seat={seat} label="tua pila" faceUp={!isScopa} slamId={slamId} right />
      </div>

      {/* choice */}
      {pick && (
        <div className="fade" style={{ border: `1px solid ${T.ink}`, borderRadius: 4, padding: 12, marginTop: 16 }}>
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
                    borderRadius: 4,
                    padding: 8,
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
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {who(room, seat)} <span style={{ color: T.ink30, fontWeight: 400 }}>tu</span>
          </div>
          <Micro>
            {tally[seat]} {unit}
            {isScopa && gs.scope[seat] ? ` · ${gs.scope[seat]} scopa` : ""}
          </Micro>
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
      <div style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start", alignItems: "flex-end" }}>
        <Stack n={pile.length} top={top} faceUp={faceUp} size="sm" right={right} slamId={slamId} />
      </div>
      <Micro style={{ marginTop: 5 }}>
        {label} {pile.length}
      </Micro>
    </div>
  );
}

/* ── straccia camicia ── */
function Camicia({ room, gs, seat, mine, slamId, commit }) {
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
        <div style={{ fontSize: 14, fontWeight: 600 }}>{who(room, opp)}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <Micro>{gs.decks[opp].length}</Micro>
          <Stack n={gs.decks[opp].length} faceUp={false} size="xs" right />
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
        <div style={{ fontSize: 14, fontWeight: 600 }}>
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
          <Stack n={gs.decks[seat].length} faceUp={false} size="md" />
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.16em", color: mine && !gs.done ? T.ink : T.ink30 }}>
            {label}
          </div>
        </div>
      </div>

      <Micro style={{ textAlign: "center", marginTop: 10 }}>
        mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
      </Micro>
    </div>
  );
}

/* ── summaries ── */
function Summary({ room, gs }) {
  if (room.game === "scopa" && gs.summary)
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 10, fontFamily: BRAND }}>
          {gs.matchDone ? `${who(room, gs.scores.A > gs.scores.B ? "A" : "B")} vince la partita` : "Mano contata"}
        </div>
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
            fontSize: 15,
            fontWeight: 600,
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
  if (room.game === "ruba" && gs.summary)
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", fontFamily: BRAND }}>
          {gs.summary.win ? `${who(room, gs.summary.win)} vince la mano` : "Perfetto pari"}
        </div>
        <Micro style={{ marginTop: 6 }}>
          {who(room, "A")} {gs.summary.a} — {who(room, "B")} {gs.summary.b} · mani {gs.tally.A}–{gs.tally.B}
        </Micro>
      </div>
    );
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", fontFamily: BRAND }}>
        {gs.win ? `${who(room, gs.win)} vince` : "Pareggio"}
      </div>
      <Micro style={{ marginTop: 6 }}>
        mani {who(room, "A")} {gs.tally.A} — {who(room, "B")} {gs.tally.B}
      </Micro>
    </div>
  );
}
