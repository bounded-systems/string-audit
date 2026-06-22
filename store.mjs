// Pluggable result store for the audit cache. The miss path is the only place an
// (expensive) audit runs; the store is what makes a hit free.
//
//   FsStore  — simple content-addressed filesystem cache (default; .cache/<key>.json)
//   CasStore — implements the bounded-systems provenance ports:
//                • cas `BlobStore`  — bytes addressed by their SHA-256 digest
//                  (put → digest; get re-hashes and rejects a corrupt/absent blob)
//                • a ref layer       — cache key → output digest (anchored-chain RefStore)
//                • a derivation log  — input(copy) → output(audit) lineage
//                  (anchored-chain DerivationStore.append shape)
//              This IS the cas/anchored-chain architecture, fs-backed and runnable.
//              When the published @bounded-systems/cas + anchored-chain land, swap
//              `sha256Hex` for cas's and the fs blob/derivation impls for theirs —
//              same ports, so the swap is local to this file. Enable with STORE=cas.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// content address — matches cas.sha256Hex (full hex SHA-256); swap when cas is installed
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
  // ── cas BlobStore port ──
  putBlob(bytes) { const d = sha256Hex(bytes); const p = join(this.blobsDir, d); if (!existsSync(p)) writeFileSync(p, bytes); return d; }
  getBlob(digest) {
    const p = join(this.blobsDir, digest);
    if (!existsSync(p)) throw new Error(`cas: absent blob ${digest}`);
    const b = readFileSync(p);
    if (sha256Hex(b) !== digest) throw new Error(`cas: corrupt blob ${digest}`); // re-hash verify
    return b;
  }
  // ── ref layer (key → output digest) ──
  #ref(key) { return join(this.refsDir, key + ".ref"); }
  // ── derivation log (anchored-chain DerivationStore.append shape) ──
  #append(rec) { appendFileSync(this.derivLog, JSON.stringify(rec) + "\n"); }
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
    this.#append({                                                             // input→output lineage
      inputs: [{ inputName: "copy", inputDigest: sha256Hex(this.enc.encode(key)) }],
      outputs: [{ outputName: "audit", outputDigest }],
    });
  }
}

export async function makeStore(fsDir) {
  return process.env.STORE === "cas" ? new CasStore(join(fsDir, "cas")) : new FsStore(fsDir);
}
