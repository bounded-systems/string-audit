// Pluggable result store for the audit cache. The miss path is the only place an
// (expensive) audit runs; the store is what makes a hit free.
//
//   FsStore  — simple content-addressed filesystem cache (default; .cache/<key>.json)
//   CasStore — backed by the real published packages:
//                • @bounded-systems/cas       — content addressing (sha256Hex / sha256BareHex);
//                  blobs stored by digest, get() re-hashes and rejects a corrupt/absent blob
//                • a ref layer                — cache key → output digest
//                • @bounded-systems/anchored-chain — each result gets a real in-toto
//                  derivation (digestManifest → derivationId, manifestToStatement →
//                  statement), serialized with canonicalJson. (DSSE ed25519 signing is
//                  a small follow-up: assembleEnvelope + ed25519Signer.)
//              Enable with STORE=cas.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";
import { sha256Hex, sha256BareHex } from "@bounded-systems/cas";
import { digestManifest, manifestToStatement, canonicalJson } from "@bounded-systems/anchored-chain";

// Where the store mounts when it's a socket "door" — inside a room (cf. guest-room).
export const socketPath = () => process.env.SOCK || join(process.env.ROOM || ".room", "store.sock");

export class FsStore {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  #p(key) { return join(this.dir, key + ".json"); }
  async has(key) { return existsSync(this.#p(key)); }
  async get(key) { return existsSync(this.#p(key)) ? JSON.parse(readFileSync(this.#p(key), "utf8")) : null; }
  async put(key, value) { writeFileSync(this.#p(key), JSON.stringify(value)); }
}

export class CasStore {
  constructor(dir) {
    this.blobsDir = join(dir, "blobs");
    this.refsDir = join(dir, "refs");
    this.derivLog = join(dir, "derivations.ndjson");
    mkdirSync(this.blobsDir, { recursive: true });
    mkdirSync(this.refsDir, { recursive: true });
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }
  // ── cas BlobStore port (content address via @bounded-systems/cas) ──
  putBlob(bytes) { const name = sha256BareHex(bytes); const p = join(this.blobsDir, name); if (!existsSync(p)) writeFileSync(p, bytes); return sha256Hex(bytes); }
  getBlob(digest) {
    const p = join(this.blobsDir, String(digest).replace(/^sha256:/, ""));
    if (!existsSync(p)) throw new Error(`cas: absent blob ${digest}`);
    const b = readFileSync(p);
    if (sha256Hex(b) !== digest) throw new Error(`cas: corrupt blob ${digest}`); // re-hash verify
    return b;
  }
  // ── ref layer (key → output digest) ──
  #ref(key) { return join(this.refsDir, key + ".ref"); }
  #append(line) { appendFileSync(this.derivLog, line + "\n"); }
  // ── Store port ──
  async has(key) { return existsSync(this.#ref(key)); }
  async get(key) {
    if (!existsSync(this.#ref(key))) return null;
    const digest = readFileSync(this.#ref(key), "utf8").trim();
    return JSON.parse(this.dec.decode(this.getBlob(digest)));
  }
  async put(key, value) {
    const outputDigest = this.putBlob(this.enc.encode(JSON.stringify(value))); // result bytes → cas
    writeFileSync(this.#ref(key), outputDigest);                               // key → result
    // real anchored-chain provenance: an in-toto derivation (input copy → output audit)
    const manifest = {
      producer: "string-audit",
      inputs: { copy: sha256Hex(this.enc.encode(key)) },
      outputs: { audit: outputDigest },
      contracts: [],
      params: {},
    };
    const derivationId = digestManifest(manifest);
    const statement = manifestToStatement(manifest);
    this.#append(canonicalJson({ derivationId, manifest, statement, ts: Date.now() }));
  }
}

// SocketStore — a client for a store mounted on a Unix socket (the "door").
// Speaks NDJSON {op,key,value}; one short-lived connection per call (lightweight).
export class SocketStore {
  constructor(sock) { this.sock = sock; }
  #rpc(req) {
    return new Promise((resolve, reject) => {
      const c = connect(this.sock);
      let buf = "";
      c.on("connect", () => c.write(JSON.stringify(req) + "\n"));
      c.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { c.end(); const m = JSON.parse(buf.slice(0, i)); m.error ? reject(new Error(m.error)) : resolve(m.result); } });
      c.on("error", reject);
    });
  }
  async has(key) { return this.#rpc({ op: "has", key }); }
  async get(key) { return this.#rpc({ op: "get", key }); }
  async put(key, value) { await this.#rpc({ op: "put", key, value }); }
}

export async function makeStore(fsDir) {
  if (process.env.STORE === "socket") return new SocketStore(socketPath()); // mounted door, in a room
  if (process.env.STORE === "cas") return new CasStore(join(fsDir, "cas"));
  return new FsStore(fsDir);
}
