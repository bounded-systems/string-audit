#!/usr/bin/env node
// Lightweight store daemon — mounts a CasStore on a Unix socket "in a room".
// The socket is the door; clients (SocketStore) speak NDJSON {op,key,value}.
// Room = the socket's directory (ROOM env, default .room/) — the guest-room
// mount point; the cas blobs/refs/lineage live under <room>/cas. Run:
//   node store-daemon.mjs &           # mounts .room/store.sock
//   STORE=socket node audit.mjs       # audits via the mounted store
import { createServer } from "node:net";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeCasStore, socketPath } from "./store.mjs";

const sock = socketPath();
const room = dirname(sock);
mkdirSync(room, { recursive: true });
if (existsSync(sock)) rmSync(sock); // clear a stale socket
const store = await makeCasStore(join(room, "cas")); // loads cas/anchored-chain backends

const server = createServer((c) => {
  let buf = "";
  c.on("data", async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const { op, key, value } = JSON.parse(line);
        const result =
          op === "has" ? await store.has(key) :
          op === "get" ? await store.get(key) :
          op === "put" ? (await store.put(key, value), true) :
          null;
        c.write(JSON.stringify({ result }) + "\n");
      } catch (e) {
        c.write(JSON.stringify({ error: String(e?.message || e) }) + "\n");
      }
    }
  });
});

const bye = () => { try { rmSync(sock, { force: true }); } catch {} process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
server.listen(sock, () => console.log(`store mounted at ${sock} (room: ${room})`));
