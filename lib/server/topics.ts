import "server-only";
import banditsBundle from "../../topics/bandits/bundle.json";
import banditsExercises from "../../topics/bandits/exercises.json";
import banditsPractice from "../../topics/bandits/practice.json";
import banditsPretest from "../../topics/bandits/pretest.json";
import banditsSurvey from "../../topics/bandits/survey.json";
import banditsCoverage from "../../topics/bandits/coverage.json";
import banditsCopy from "../../topics/bandits/copy.json";
import banditsIntro from "../../topics/bandits/sources/chunks/mab-intro.json";
import banditsDml from "../../topics/bandits/sources/chunks/mab-dml.json";

// The topic packs this server can run. A pack is everything one topic brings, as the content files in
// topics/<slug>/ define it: the bundle (pnpm content bundle <slug>: ideas, facts, Kai's questions, videos), the
// practice problems, the final test's forms, the pretest, the questions after the test, where the videos cover each
// fact (coverage and the transcript chunks), and the participant-facing wording (copy.json). The study (lib/settings.ts)
// picks one pack and arranges the steps around it.
//
// To add a topic: write its files in topics/<slug>/, run pnpm content ingest|validate|bundle <slug>, and add a line
// below. Static imports, so the build bundles every pack (nothing is read from disk at run time).

export type RawPack = {
  bundle: unknown;
  exercises: unknown;
  practice: unknown;
  pretest: unknown;
  survey: unknown;
  coverage: unknown;
  copy: unknown;
  chunks: Record<string, unknown>; // transcript chunks per video source id
};

export const RAW_PACKS: Record<string, RawPack> = {
  bandits: {
    bundle: banditsBundle,
    exercises: banditsExercises,
    practice: banditsPractice,
    pretest: banditsPretest,
    survey: banditsSurvey,
    coverage: banditsCoverage,
    copy: banditsCopy,
    chunks: { "mab-intro": banditsIntro, "mab-dml": banditsDml },
  },
};

/** The pack a fresh install runs, and the one sessions from before topics were selectable belong to. */
export const DEFAULT_TOPIC = "bandits";
