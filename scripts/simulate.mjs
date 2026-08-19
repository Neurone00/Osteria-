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
  "makeDeck", "shuffle", "GAMES",
  "dealScopa", "scopaOptions", "scopaPlay", "scoreScopa", "primiera",
  "dealRuba", "rubaOptions", "rubaPlay",
  "dealCamicia", "camiciaFlip", "demand",
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

/* ── run ────────────────────────────────────────────────────── */
const stat = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}, median ${xs.slice().sort((a, b) => a - b)[xs.length >> 1]}`;

const runs = [
  ["scopa, base rules", () => playScopa({ target: 11, asso: false, rebello: false, napola: false })],
  ["scopa, asso piglia tutto + rebello + napola", () => playScopa({ target: 11, asso: true, rebello: true, napola: true })],
  ["rubamazzo, table matches only", () => playRuba({ sums: false })],
  ["rubamazzo, northern sums", () => playRuba({ sums: true })],
  ["camicia, italian (A/2/3)", () => playCamicia({ intl: false })],
  ["camicia, international (A4 R3 C2 F1)", () => playCamicia({ intl: true })],
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

console.log(failures ? `\n${failures} failure(s)` : "\nAll invariants held: 40 cards accounted for throughout, no stuck seats, every hand terminated.");
process.exit(failures ? 1 : 0);
