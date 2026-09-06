# Kickoff prompt for Claude Code

Unzip the repo, `cd` into it, run `claude`, and paste the block below. `CLAUDE.md` is picked up automatically,
so the prompt stays short on purpose — it says what to do, not what the project is.

---

```
This repo is Osteria: three Italian card games for two players on two devices, joined
by a four-letter code. Read CLAUDE.md and README.md first — the rules and the transport
design are already settled and verified, so don't redesign them.

Goal for this session: get it live on Cloudflare and confirm two people can actually
play, then close the highest-value gaps.

1. Deploy. `npm install`, then `npx wrangler deploy --dry-run --outdir=/tmp/w` to check
   the config, then `npx wrangler login` and `npm run deploy`. The Worker is named
   neurone00 in wrangler.toml. Tell me the URL when it's up. If any binding, migration
   or assets setting is rejected, fix it against the current Cloudflare docs rather
   than guessing — Durable Objects on the free plan need the SQLite backend.

2. Prove the relay works before I test on phones. Run `npm run tail` in one shell, and
   in another open two WebSocket clients to wss://<url>/room/TEST — send a state
   message from one, confirm the other receives it and that a third connection joining
   later gets the stored state immediately. Report what you actually observed.

3. Extract the rules engines out of src/App.jsx into src/rules.js, import them back,
   and write scripts/simulate.mjs that plays a few hundred random deals of each game
   checking for card leaks (40 cards always accounted for), stuck states, and hands
   that never terminate. Both scopa variants and both camicia variants. This is a pure
   refactor — the UI must render identically and App.jsx must still run unmodified as a
   Claude artifact, so no new imports on the artifact code path.

4. Re-bundle and redeploy, then give me a short checklist for testing on two phones:
   what to try in each game, and what would indicate the sync or the reload-restore is
   broken.

Don't touch the visual design or the slam feedback. Ask me before adding any dependency.
```

---

## If Claude Code hits a wall

- **`unavailable-id` / DO migration rejected** — the migration must be `new_sqlite_classes`, not `new_classes`.
  Already set that way in `wrangler.toml`; if the account already has a key-value-backed namespace of the same
  class name, rename the class instead of converting it.
- **Assets not found** — `[assets] directory = "./standalone"` is relative to `wrangler.toml`, and
  `standalone/index.html` is generated. Run `npm run bundle` if the folder looks empty.
- **Deployed site serves old code** — same cause. `npm run deploy` bundles first; `npx wrangler deploy` alone
  does not.
