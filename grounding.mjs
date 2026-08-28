// The SINGLE definition of "may this claim assert this?" — deliberately zero-dependency
// so audit-gate.mjs can import it. That gate runs against a *caller's* node_modules
// (an-array-of-english-words + write-good only — no zod), which is why it previously kept
// its own copy of the matcher inline and types.mjs kept another. Two copies of a security
// predicate drift; this is the one place to change it.
//
// A grounding source is one of two shapes:
//
//   flat        ["term", …]                     one repo auditing its own catalog
//   namespaced  { "<repo>": ["term", …], … }    the org-wide aggregate
//
// Namespacing exists because the flat org-wide union was a hole (content-catalog#14):
// every opted-in repo's terms were merged into one set, so a claim in ANY repo passed on
// a term contributed by an UNRELATED repo. `brand`'s file is a brand *vocabulary* list —
// bare nouns like "agent", "door", "process" — so "Our agent is provably unbreakable."
// passed the honesty gate backed by nothing. Under a namespaced source a claim from repo
// X is groundable only by X's own declared terms.

export const STAT_RE = /\b\d[\d,. ]*\s*(%|stars?|customers?|reviews?|bpm|days?|x)\b/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word-boundary match, not substring. Substring matching let the bare noun "agent" ground
// "agentic" and "management", "door" ground "doorway", "process" ground "processed" — so a
// one-word term grounded far more prose than it backs. \b is applied only at an end that is
// alphanumeric: a \b next to punctuation can never fire, which would silently break terms
// like "100%", "-foo" or "in-toto" if applied unconditionally.
export function matchesTerm(value, term) {
  const t = String(term ?? "").trim().toLowerCase();
  if (!t) return false;
  const lead = /^[\p{L}\p{N}]/u.test(t) ? "\\b" : "";
  const tail = /[\p{L}\p{N}]$/u.test(t) ? "\\b" : "";
  return new RegExp(`${lead}${escapeRe(t)}${tail}`, "iu").test(value);
}

/** A grounding source is namespaced when it is a plain object rather than a term array. */
export const isNamespaced = (grounding) =>
  !!grounding && typeof grounding === "object" && !Array.isArray(grounding);

/**
 * Which declared repo owns this symbol, for a namespaced source. Merged symbols are keyed
 * `<repo>.<key>` — but repo names may themselves contain dots (`bounded.tools` is a real
 * repo in this org), so splitting on the FIRST dot attributes `bounded.tools.tagline` to a
 * repo named "bounded" and silently grounds it against the wrong set. Match the LONGEST
 * declared repo that prefixes the symbol at a dot boundary instead.
 */
export function repoFor(symbol, grounding) {
  if (!isNamespaced(grounding)) return null;
  let best = null;
  for (const repo of Object.keys(grounding)) {
    if (repo.startsWith("$")) continue; // reserved for metadata, as elsewhere in the catalogs
    if (symbol.startsWith(`${repo}.`) && (best === null || repo.length > best.length)) best = repo;
  }
  return best;
}

/**
 * The terms `symbol` may be grounded by. A flat source grounds every symbol (single-repo
 * callers). Under a namespaced source, a symbol whose repo declared no grounding gets NO
 * terms and its claims therefore fail — fail closed, which is exactly what should have
 * happened for a repo contributing no grounding but is not what the flat union did.
 */
export function termsFor(symbol, grounding) {
  if (!isNamespaced(grounding)) return Array.isArray(grounding) ? grounding : [];
  const repo = repoFor(symbol, grounding);
  const terms = repo === null ? [] : grounding[repo];
  return Array.isArray(terms) ? terms : [];
}

export const groundedBy = (value, terms = []) => terms.filter((t) => matchesTerm(value, t));
export const isGrounded = (value, terms = []) => terms.some((t) => matchesTerm(value, t));
