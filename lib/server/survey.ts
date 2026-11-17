import "server-only";
import type { SurveyItem } from "../settings";
import type { Pack } from "./content";

// The questions after the test as the admin panel reads them back: the pack's own questions, then those taken out
// (survey.json `retired`, with their last day), so every answer in the log can be put into words.

export type SurveyQuestion = SurveyItem & { until?: string };

/** Every question a session may have answered, in the pack's order: those asked now, then those taken out. */
export const surveyQuestions = (pack: Pack): SurveyQuestion[] => [...pack.survey, ...pack.surveyRetired];

/** An answer in words: a choice's option, a scale's point ("5 of 7"), an open answer as written. */
export function answerText(q: SurveyQuestion | undefined, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (q?.kind === "choice") return q.options?.[Number(v)] ?? String(v);
  if (q?.kind === "scale") return `${String(v)} of ${q.points ?? 7}`;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Who a session's answers belong with: the practice it did (a team session may switch), else its condition. */
export const practisedOf = (r: Record<string, unknown>) => String(r.practised ?? r.practiceView ?? r.condition ?? "direct") as "direct" | "recursive";
