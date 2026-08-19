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
    return env.ASSETS.fetch(request);
  },
};

const DAY = 24 * 60 * 60 * 1000;

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
