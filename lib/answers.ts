// What a final-test answer looks like, in the browser (lib/client/store.ts) and on the server (content/test.ts):
// an option's index (choice), the indices of the statements ticked (multi, select all that apply), a typed number as
// typed (number), "I don't know" (an item that offers it), or nothing yet.

export const DONT_KNOW = "idk";
export type TestAnswer = number | number[] | string | null;

/** A reason long enough to count as one (items that ask for it): a few words, not a single one. */
export const REASON_MIN_WORDS = 3;
export const reasonGiven = (text: string | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean).length >= REASON_MIN_WORDS;
