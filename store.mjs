// Pluggable result store for the audit cache. The miss path is the only place an
// (expensive) audit runs; the store is what makes a hit free.
//
//   FsStore  — content-addressed filesystem cache (default; .cache/<key>.json)
//   CasStore — backs the cache with @bounded-systems/cas (result bytes, by digest)
//              + anchored-chain: a RefStore maps cache key → result digest, and a
//              DerivationStore records input(copy)→output(audit) so every cached
//              result has signed lineage. Enable with STORE=cas.
//
// Same get/put/has port either way, so the cas backing is a drop-in (cf. cas's own
// note: "local impl now, OCI-registry-backed impl later, same port").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class FsStore {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  #p(key) { return join(this.dir, key + ".json"); }
  async has(key) { return existsSync(this.#p(key)); }
  async get(key) { return existsSync(this.#p(key)) ? JSON.parse(readFileSync(this.#p(key), "utf8")) : null; }
  async put(key, value) { writeFileSync(this.#p(key), JSON.stringify(value)); }
}

export class CasStore {
  constructor({ blobs, refs, derivations, sha256Hex }) {
    Object.assign(this, { blobs, refs, derivations, sha256Hex });
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }
  async has(key) { return (await this.refs.get(key)) !== null; }
  async get(key) {
    const ref = await this.refs.get(key);
    return ref ? JSON.parse(this.dec.decode(await this.blobs.get(ref.digest))) : null;
  }
  async put(key, value) {
    const outputDigest = await this.blobs.put(this.enc.encode(JSON.stringify(value))); // result bytes → cas
    await this.refs.set(key, { digest: outputDigest });                                // key → result
    await this.derivations.append({                                                    // lineage (input→output)
      inputs: [{ inputName: "copy", inputDigest: this.sha256Hex(key) }],
      outputs: [{ outputName: "audit", outputDigest }],
    });
  }
}

// CasStore when STORE=cas and both packages are installed; else FsStore.
// NOTE: the concrete factory names below are wired when the packages are present —
// finalize against their exported constructors at integration time.
export async function makeStore(fsDir) {
  if (process.env.STORE === "cas") {
    try {
      const cas = await import("@bounded-systems/cas");
      const ac = await import("@bounded-systems/anchored-chain");
      const blobs = cas.createBlobStore?.();
      const refs = ac.createRefStore?.();
      const derivations = ac.createDerivationStore?.();
      if (blobs && refs && derivations) return new CasStore({ blobs, refs, derivations, sha256Hex: cas.sha256Hex });
      console.warn("STORE=cas: packages present but factory names need wiring — using FsStore");
    } catch {
      console.warn("STORE=cas requested but @bounded-systems/cas / anchored-chain not installed — using FsStore");
    }
  }
  return new FsStore(fsDir);
}
