// Per-type symbol contracts — the SINGLE Zod source for what each typed string must be.
// Used by `audit` (the deterministic type-scoped checks) AND `scan` (Zod-validating the
// keepers it lifts from source). One place to change the rules for a `headline`/`cta`/`meta`.
import { z } from "zod";

// The structural contracts. `claim` is grounding-dependent (the grounding source is
// per-run), so it isn't a static schema — see claimFindings(). Check order is preserved
// so the audit's finding order is unchanged.
export const SYMBOL_TYPES = {
  headline: z.string()
    .max(65, "too long for a headline (>65)")
    .min(15, "too short to carry the value prop")
    .refine((v) => !/\b(best|amazing|world-class|revolutionary)\b/i.test(v), "superlative filler"),
  cta: z.string()
    .refine((v) => /^(shop|get|buy|try|start|send|order|gift)\b/i.test(v.trim()), "doesn't open with an action verb")
    .refine((v) => v.length <= 24, "CTA too long to scan"),
  meta: z.string()
    .max(160, "meta too long (>160 chars)")
    .min(70, "meta thin (<70)"),
  body: z.string(),
};

// type → finding messages (strings). Mirrors the old hand-coded checks; `claim` is dynamic.
export function typeFindings(type, value) {
  if (type === "claim") return claimFindings(value, []); // callers with grounding use claimFindings directly
  const schema = SYMBOL_TYPES[type];
  if (!schema) return [];
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

// A `claim` may only assert facts in the grounding source; an ungrounded stat is flagged,
// never rewritten as fact. Dynamic (depends on the per-run grounding), so it's not a schema.
export function claimFindings(value, grounded = []) {
  const stat = value.match(/\b\d[\d,. ]*\s*(%|stars?|customers?|reviews?|bpm|days?|x)\b/i);
  const isGrounded = grounded.some((g) => value.toLowerCase().includes(g));
  return [
    stat && !isGrounded && `UNGROUNDED stat "${stat[0].trim()}" — not in the grounding source; flag, never ship/rewrite as fact`,
    !stat && !isGrounded && "claim asserts nothing grounded — verify against source",
  ].filter(Boolean);
}

// Infer a symbol type from a bare string — for scan / extraction (the catalog carries
// explicit types; freshly-lifted strings don't).
export const inferType = (s) =>
  /^(shop|get|buy|try|start|send|order|gift|read|learn|see|join|explore|run|use|add)\b/i.test(s) && s.length <= 24 ? "cta" :
  /\b(every|always|guaranteed|never|100%|rated|\d+\s*(?:stars?|customers?|reviews?))\b/i.test(s) ? "claim" :
  s.length >= 50 && s.length <= 160 ? "meta" :
  /^[A-Z][^.!?]{0,63}$/.test(s.trim()) && s.length <= 65 ? "headline" :
  "body";
