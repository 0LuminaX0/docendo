// The text lesson (a topic pack's lesson.json) as the pages see it: client-safe, no schemas. The server parses the
// file (content/pack.ts, LessonFile) and hands the pages what they show; the figures and formulas are components
// (components/lesson/), named here by id so `pnpm content validate` can check a pack names only ones that exist.

export const FIGURES = ["averages", "lockin", "lottery", "bonus", "score"] as const;
export const FORMULAS = ["greedy", "epsilon", "ucb"] as const;
export type FigureId = (typeof FIGURES)[number];
export type FormulaId = (typeof FORMULAS)[number];

export type LessonBlock = { p: string } | { formula: string } | { figure: string; caption: string };
export type LessonSection = { id: string; title: string; nodes: string[]; blocks: LessonBlock[] };
export type Lesson = { title: string; minutes: number; minSeconds: number; remindSeconds: number; intro: string; sections: LessonSection[]; end: string };

/** A passage of the lesson shown again as help (teaching, practice): a section, with its text once help is open. */
export type Passage = { section: string; title: string; blocks?: LessonBlock[] };

/** The lesson's words as plain text, for word counts and for comparing learners' messages with it. */
export function lessonWords(lesson: Pick<Lesson, "intro" | "sections" | "end">): string {
  const text = [lesson.intro, ...lesson.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => ("p" in b ? [b.p] : "caption" in b ? [b.caption] : []))]), lesson.end].join(" ");
  return text.replace(/\*\*/g, "");
}

/** A message sharing this many consecutive words with the lesson gets Kai's copied-text reply, and nothing is judged. */
export const COPIED_RUN = 15;
/** For the log: the share of a message's words that lie in runs of at least this many words shared with the lesson. */
export const OVERLAP_RUN = 8;

/** Words as compared with the lesson: lower case, punctuation dropped, ε written as "epsilon". */
export const wordsOf = (text: string): string[] => text.toLowerCase().replace(/ε/g, " epsilon ").match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * How much of a message comes word for word from the lesson: its longest run of consecutive words that also stand in
 * the lesson, in that order, and how many of its words lie in shared runs of OVERLAP_RUN or more. Shorter shared runs
 * occur in natural explanations ("the option with the highest average so far" is 8 words of the bandits text), so only
 * a long run counts as copied.
 */
export function makeOverlap(lessonText: string) {
  const L = wordsOf(lessonText);
  const grams = new Set<string>();
  for (let i = 0; i + OVERLAP_RUN <= L.length; i++) grams.add(L.slice(i, i + OVERLAP_RUN).join(" "));
  return (message: string): { words: number; longest: number; inRuns: number } => {
    const M = wordsOf(message);
    // the longest common run of words (longest common substring, counted in words)
    let longest = 0;
    let prev = new Array<number>(L.length + 1).fill(0);
    for (let i = 1; i <= M.length; i++) {
      const cur = new Array<number>(L.length + 1).fill(0);
      for (let j = 1; j <= L.length; j++)
        if (M[i - 1] === L[j - 1]) {
          cur[j] = prev[j - 1]! + 1;
          if (cur[j]! > longest) longest = cur[j]!;
        }
      prev = cur;
    }
    const covered = new Array<boolean>(M.length).fill(false);
    for (let i = 0; i + OVERLAP_RUN <= M.length; i++) if (grams.has(M.slice(i, i + OVERLAP_RUN).join(" "))) for (let k = i; k < i + OVERLAP_RUN; k++) covered[k] = true;
    return { words: M.length, longest, inRuns: covered.filter(Boolean).length };
  };
}
