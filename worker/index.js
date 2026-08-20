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
    const room = url.pathname.match(/^\/room\/([a-zA-Z]{4})$/);
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

// One shared object for everyone bumping. The first to arrive waits; the next
// one is paired with it — both get the same fresh code (first is host), then
// both bump sockets close and the two phones reconnect to /room/CODE. Matching
// is FIFO, so it assumes the two people bumping are each other's opponent —
// true for friends across a table, which is the whole use case.
export class BumpLobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("This endpoint expects a WebSocket.", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    const waiting = this.ctx.getWebSockets(); // whoever is already waiting, before we accept the newcomer
    this.ctx.acceptWebSocket(server);
    const other = waiting.find((w) => w.readyState === 1) || waiting[0];
    if (other) {
      const code = randomCode();
      try {
        other.send(JSON.stringify({ type: "paired", code, host: true }));
      } catch {}
      try {
        server.send(JSON.stringify({ type: "paired", code, host: false }));
      } catch {}
      try {
        other.close(1000, "paired");
      } catch {}
      try {
        server.close(1000, "paired");
      } catch {}
    } else {
      try {
        server.send(JSON.stringify({ type: "waiting" }));
      } catch {}
    }
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
