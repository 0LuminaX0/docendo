import "server-only";
import { CONFIG } from "../../engine/tutor/policy";
import { teachableRequired } from "../../engine/tutor/state";
import { BLOCKS, flowOf, minutesOf, type StepKey } from "../flow";
import type { Settings } from "../settings";
import { packFor, topicSlugs, type Pack } from "./content";
import { getSettings } from "./settings";

// What a study consists of, counted from the topic pack and the settings rather than written down: the admin panel's
// Settings page (each block's summary, the session's length, what is fixed by design) and its Content page.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function packSummary(pack: Pack, s: Settings) {
  const lessonNodes = pack.bundle.nodes.filter((n) => n.inLesson !== false);
  const facts = lessonNodes.flatMap(teachableRequired);
  const rounds = [...new Set(pack.practice.map((p) => p.round))].sort();
  const forms = pack.forms.map((f) => {
    const items = pack.formItems(f);
    return { form: f, items: items.length, choice: items.filter((q) => q.kind === "choice").length, number: items.filter((q) => q.kind === "number").length };
  });
  const n = { pretest: pack.pretest.length, test: forms[0]?.items ?? 0 };
  const flow = flowOf(s);
  const minutes = Object.fromEntries(BLOCKS.map((b) => [b.key, minutesOf(b.key, s, n)])) as Record<StepKey, number>;
  const lessonSec = s.watch.parts.reduce((a, p) => a + Math.max(0, p.end - p.start), 0);
  const coverage = pack.lessonCoverage(s.watch.on ? s.watch.parts : []);
  const testText = forms.map((f) => `form ${f.form}: ${plural(f.items, "question")} (${f.choice} to choose, ${f.number} to work out)`).join("; ");
  return {
    slug: pack.slug,
    title: pack.title,
    subject: pack.copy.subject,
    goal: pack.bundle.goals[0]?.text ?? "",
    ideas: lessonNodes.length,
    ideasAround: pack.bundle.nodes.length - lessonNodes.length,
    facts: facts.length,
    videos: pack.bundle.videos.length,
    practice: { problems: pack.practice.length, rounds: rounds.map((r) => pack.practice.filter((p) => p.round === r).length) },
    forms,
    pretest: { items: pack.pretest.length, knowledge: pack.pretest.filter((q) => q.kind === "knowledge").length },
    survey: pack.survey.length,
    coverage,
    flow,
    minutes,
    total: flow.reduce((a, k) => a + minutes[k], 0) + (s.survey.on && pack.survey.length ? 1 : 0),
    // one line per block for the Settings page, from the pack and the settings
    blocks: {
      pretest: `${plural(pack.pretest.length, "question")} (${pack.pretest.filter((q) => q.kind === "knowledge").length} on neighbouring ideas), about ${minutes.pretest} min`,
      watch: s.watch.parts.length ? `${plural(s.watch.parts.length, "part")} from ${plural(new Set(s.watch.parts.map((p) => p.videoId)).size, "video")}, ${mmss(lessonSec)} in all` : "no parts yet",
      teach: `${plural(lessonNodes.length, "idea")}, ${plural(facts.length, "fact")} Kai waits for; usually about ${minutes.teach} min`,
      practice: `${plural(pack.practice.length, "problem")}${rounds.length > 1 ? ` in ${rounds.length} rounds (${rounds.map((r) => pack.practice.filter((p) => p.round === r).length).join(" + ")})` : ""}, ${s.practice.minutes} min`,
      exercises: `${testText}, about ${minutes.exercises} min`,
      results: `the score, every answer explained${s.practice.on ? ", the practice's worked solutions" : ""}`,
      survey: `${plural(pack.survey.length, "question")} after the test, before the score`,
    } as Record<StepKey | "survey", string>,
    // part of the study design: changed in code, with a reason, not mid-study
    fixed: [
      ["Kai feels ready", `at ${CONFIG.ready * 100}% of the ${facts.length} facts it waits for, or ${CONFIG.readyLate * 100}% after ${CONFIG.lateAfterMin} minutes of teaching (engine/tutor/policy.ts)`],
      ["Kai wraps up", `after ${CONFIG.maxTurns} learner messages (engine/tutor/policy.ts)`],
      ["Practice problems", `${plural(pack.practice.length, "problem")}, the same in both conditions (topics/${pack.slug}/practice.json)`],
      ["Final test", `${testText} (topics/${pack.slug}/exercises.json)`],
      ["Conditions", `from the access code, balanced in blocks of 4${forms.length > 1 ? "; test forms alternate within each condition" : ""}`],
      ["Consent", "the wording on the welcome page, versioned in app/api/session/route.ts"],
    ] as [string, string][],
  };
}
export type PackSummary = ReturnType<typeof packSummary>;

/** Every topic pack this server has, for the topic picker. */
export const topicList = () => topicSlugs().map((slug) => ({ slug, title: packFor(slug).title }));

/** The study in force: its settings, their version, and the topic pack it runs. */
export async function currentStudy(opts: { fresh?: boolean } = {}) {
  const { settings, version } = await getSettings(opts);
  return { settings, version, pack: packFor(settings.topic) };
}
