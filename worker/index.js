/**
 * Osteria on Cloudflare.
 *
 * One Worker does two jobs:
 *   · serves the static game from ./standalone
 *   · relays a table's state over WebSockets, one Durable Object per code
 *
 * A table is just `idFromName("ABCD")`, so both phones dialling the same four
 * letters land in the same object, wherever they are. The object keeps the last
 * state it saw, which is what lets a reload — or a closed tab — rejoin a hand
 * already in progress.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /room/CODE  → the live WebSocket relay
    // /room/CODE/state → a read-only JSON dump of what the table currently holds
    //   (scores, whose turn, version). A debug hatch: open it in a browser to see
    //   why two phones disagree. Same data the clients already exchange over the
    //   wire, so it exposes nothing new — delete the route to close it off.
    const room = url.pathname.match(/^\/room\/([a-zA-Z]{4})(\/state)?$/);
    if (room) {
      const id = env.TABLE.idFromName(room[1].toUpperCase());
      return env.TABLE.get(id).fetch(request);
    }
    // "Bump": two phones that both tap Bump land in one shared lobby object and
    // are matched into a fresh table code.
    if (url.pathname === "/bump") {
      const id = env.BUMP.idFromName("lobby");
      return env.BUMP.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

const DAY = 24 * 60 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

// Metres between two lat/lng points (haversine).
function distM(a, b) {
  const R = 6371000,
    rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const BUMP_WINDOW = 10000; // only match bumpers seen within the last ~10s
const BUMP_NEAR = 200; // metres — two phones this close are at the same table

// One shared lobby for everyone bumping. To keep it solid for a public app,
// a newcomer is paired with the *nearest* recent waiter within ~200m (by the
// coordinates each phone reports); with no location, it falls back to any
// waiter inside the short time window. Each socket carries its coords + time in
// a hibernation-safe attachment. Paired phones get one fresh code (first is
// host) and reconnect to /room/CODE.
export class BumpLobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("This endpoint expects a WebSocket.", { status: 426 });
    const url = new URL(request.url);
    const lat = parseFloat(url.searchParams.get("lat"));
    const lng = parseFloat(url.searchParams.get("lng"));
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
    const now = Date.now();
    const [client, server] = Object.values(new WebSocketPair());
    const waiters = this.ctx.getWebSockets(); // existing waiters, before accepting the newcomer
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ lat, lng, hasLoc, t: now });

    let best = null;
    let bestD = Infinity;
    for (const w of waiters) {
      let a = null;
      try {
        a = w.deserializeAttachment();
      } catch {}
      if (!a || now - (a.t || 0) > BUMP_WINDOW) continue; // gone or too old
      let d;
      if (hasLoc && a.hasLoc) {
        d = distM({ lat, lng }, a);
        if (d > BUMP_NEAR) continue; // not the same place — never cross-match
      } else {
        d = 1e6; // no location on one side → allowed, but any real proximity wins
      }
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }

    if (best) {
      const code = randomCode();
      let ok = true;
      try {
        best.send(JSON.stringify({ type: "paired", code, host: true }));
      } catch {
        ok = false;
      }
      if (ok) {
        try {
          server.send(JSON.stringify({ type: "paired", code, host: false }));
        } catch {}
        try {
          best.close(1000, "paired");
        } catch {}
        try {
          server.close(1000, "paired");
        } catch {}
        return new Response(null, { status: 101, webSocket: client });
      }
    }
    try {
      server.send(JSON.stringify({ type: "waiting" }));
    } catch {}
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketClose(ws) {
    try {
      ws.close();
    } catch {}
  }
  async webSocketError() {}
}

export class Table {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    // Read-only debug hatch: GET /room/CODE/state returns the stored room as
    // JSON so you can inspect the live scores/turn/version without a WebSocket.
    if (new URL(request.url).pathname.endsWith("/state")) {
      const room = await this.ctx.storage.get("room");
      return new Response(JSON.stringify(room ?? null, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint expects a WebSocket.", { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation-aware: the object can be evicted between moves without
    // dropping either player's socket.
    this.ctx.acceptWebSocket(server);

    const room = await this.ctx.storage.get("room");
    if (room) server.send(JSON.stringify({ type: "state", room }));
    this.announce();

    return new Response(null, { status: 101, webSocket: client });
  }

  announce() {
    const sockets = this.ctx.getWebSockets();
    const note = JSON.stringify({ type: "presence", n: sockets.length });
    for (const ws of sockets) {
      try {
        ws.send(note);
      } catch {}
    }
  }

  async webSocketMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data.type === "state" && data.room) {
      await this.ctx.storage.put("room", data.room);
      // Abandoned tables clear themselves out after a day.
      await this.ctx.storage.setAlarm(Date.now() + DAY);
    }
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(raw);
      } catch {}
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try {
      ws.close(code, reason);
    } catch {}
    this.announce();
  }

  async webSocketError() {
    this.announce();
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
