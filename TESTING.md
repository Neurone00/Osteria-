# Testing on two phones

The first real test. Everything before this was simulation and headless rendering, so this is the
first time the transport carries a hand between two actual devices.

Open the URL on both phones. One taps **Open a table** and reads out the four letters; the other taps
**Join** and types them. Use mobile data on one phone and wi-fi on the other for at least one hand —
same-wi-fi is the easy case and it will hide problems.

## Before anything else

- Both phones show the other player's name in the header, and the link reads **live**, not *waiting*.
- Play one card. It lands on both screens with the slam: overshoot, jolt, thwack, haptic tap.
- If the link says *waiting* for more than a few seconds, the handshake didn't complete — see
  **When it's the sync** below.

## Scopa

- Play a card that matches a table card exactly. It should take **that card only** — the app should
  not offer you a sum instead. That's the Italian rule and it's deliberate.
- Play a card where two different sums are legal. You should get a choice, and the choice you make
  should be the one that lands on the other phone.
- Empty the table. Both phones should say **scopa** and the score should go up by one.
- Play to the end of a deal. The last player to capture sweeps the remainder, and that sweep is
  **not** a scopa. Check the scoring panel lists carte, denari, settebello and primiera.
- As host, turn on **asso piglia tutto** in the lobby and play a hand. An ace should sweep the table
  without scoring a scopa — unless the only card on the table was an ace.

## Rubamazzo

- Match a table card when two of that value are showing. **Both** should come to you.
- Get your opponent's exposed top card in hand and play it. Their whole pile moves to you — that's
  the one that should feel unfair, and it's right.
- Try to steal a pile with a sum rather than an exact match. It should refuse. Piles go by direct
  value match only, even with **northern sums** turned on.

## Straccia camicia

- Just flip. No decisions at all.
- Turn an asso, due or tre and the other phone should show the debt: 1, 2 or 3 to pay.
- Turn an attacking card **while you're paying**. The debt should reverse onto them.
- Pay in full without turning one and the attacker takes the middle pile.
- There is no slap rule. That's deliberate — network latency would decide the race instead of your
  reflexes.

## The reload test — do this one on purpose

Phones reload games at the worst moments, so force it while a hand is in progress:

1. Mid-hand, **pull down hard** on the screen. Nothing should happen. No refresh, no bounce.
2. Now reload deliberately from the browser menu. You should get an "are you sure" prompt first.
3. Confirm it. You should land **back in the same hand**, same cards, same score — not the lobby.
4. Do it on the host's phone too, not just the guest's. The host holds the game state, so the host
   reload is the one that matters.

## When it's the sync

Signs the transport is the problem rather than the rules:

- The link indicator sits on **waiting** or drops to **lost** while both phones have signal.
- One phone shows a card the other doesn't, and it stays that way. Whole states are sent per move
  with a version number, so a difference that never resolves means a message was dropped, not delayed.
- A move lands on your phone but the turn indicator stays on you.
- Tap **Reconnect** in the header. If that fixes it, the socket died. If it doesn't, the table did.

Right now the two phones are introduced by the free public PeerJS broker and then talk directly, so:
**if the host closes the tab, the table dies.** That is expected on this host, not a bug. The
Cloudflare Worker in `worker/index.js` is what fixes it — tables there survive reloads and closed
tabs because the Durable Object keeps the last state.

## When it's the rules

Before assuming a rule is wrong, check `README.md` — the variants were researched and are verified by
`npm test` over 300 random deals each. Two that look like bugs and aren't: scopa forces the
single-card capture, and straccia camicia attacks on asso/due/tre rather than the figures.

What would be a real bug: a card that vanishes, a card that appears twice, a hand that can't be
continued because nobody has a legal move, or a score that doesn't match the lines listed beside it.
Those are exactly what the simulation checks for, so if you see one, it happened in the UI or in
transit rather than in the rules.
