// Per state disciplinary lookup. A state is measured only when this file
// has a public, unauthenticated feed for it. Guessing a count is not allowed.

const ADAPTERS = new Map();

export function registerLicensingBoard(stateName, lookup) {
  ADAPTERS.set(String(stateName || "").trim().toLowerCase(), lookup);
}

export function disciplinaryLookup({ state } = {}) {
  const name = String(state || "").trim();
  const adapter = ADAPTERS.get(name.toLowerCase());
  if (!adapter) {
    return {
      status: "missing",
      state: name || null,
      supported: false,
      actions: null,
      reason: name
        ? `${name} has no supported public disciplinary feed. A count was not guessed.`
        : "The state was missing, so a licensing board was not checked."
    };
  }
  return adapter({ state: name });
}
