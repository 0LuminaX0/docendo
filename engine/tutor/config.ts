// Kai's fixed rules and limits, in a file of their own with no imports, so the browser can show them (Kai's mind
// explains when Kai feels ready; the chat caps a message) without pulling in the engine. policy.ts and state.ts re-export them.

/** Longest learner message, in characters (about 600 words: room for a pasted explanation). */
export const MESSAGE_MAX = 4000;

export const CONFIG = {
  ready: 0.8, // share of teachable required facts explained before Kai feels ready…
  readyLate: 0.5, // …or this share once the learner has taught for lateAfterMin minutes
  lateAfterMin: 8,
  maxTurns: 30, // learner messages; Kai wraps up after this many regardless
  tries: 1, // Kai asks each fact's question once…
  triesIfClose: 2, // …or twice when the answer was partly right (or wrong)
};
