// Counts in running text, as a person would write them: "three problems", "Ten questions", "2 tries" past twelve.
// Shared by the pages that describe the study from the settings and the topic pack (nothing about it is written down).

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "three", or the digits past twelve. */
export const numberWord = (n: number) => WORDS[n] ?? String(n);
/** "Three", for the start of a sentence. */
export const NumberWord = (n: number) => {
  const w = numberWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
/** "three problems", "one problem". */
export const count = (n: number, one: string, many = `${one}s`) => `${numberWord(n)} ${n === 1 ? one : many}`;
/** "Three problems", for the start of a sentence. */
export const Count = (n: number, one: string, many = `${one}s`) => `${NumberWord(n)} ${n === 1 ? one : many}`;
