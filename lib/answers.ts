// What a final-test answer looks like, in the browser (lib/client/store.ts) and on the server (content/test.ts):
// an option's index (choice), the indices of the statements ticked (multi, select all that apply), a typed number as
// typed (number), "I don't know" (an item that offers it), or nothing yet.

export const DONT_KNOW = "idk";
export type TestAnswer = number | number[] | string | null;

/** A reason given (items that ask for it): anything written counts, a word or a symbol; no length and no calculation
 * asked for (2026-11-05: three words read as requiring a calculation, which passed the count). */
export const reasonGiven = (text: string | undefined) => (text ?? "").trim().length > 0;
