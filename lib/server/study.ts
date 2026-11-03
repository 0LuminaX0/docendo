import "server-only";
import { CONFIG } from "../../engine/tutor/policy";
import { teachableRequired } from "../../engine/tutor/state";
import { BLOCKS, flowOf, minutesOf, type StepKey } from "../flow";
import type { Settings } from "../settings";
import { hasTopic, packFor, topicSlugs, type Pack } from "./content";
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
    return { form: f, items: items.length, choice: items.filter((q) => q.kind === "choice").length, multi: items.filter((q) => q.kind === "multi").length, number: items.filter((q) => q.kind === "number").length, reasons: items.filter((q) => q.reason).length };
  });
  // what one session answers: one form, or in a pilot both (an anchor once); about a minute a question, more with a
  // written reason
  const both = s.test.both && pack.forms.length > 1;
  const asked = pack.forms.length ? pack.sessionItems(pack.forms[0]!, both) : [];
  const test = { both, items: asked.length, minutes: Math.round(asked.reduce((a, q) => a + (q.reason ? 1.25 : 1), 0)) };
  const n = { pretest: pack.pretest.length, test: test.minutes };
  const flow = flowOf(s);
  const minutes = Object.fromEntries(BLOCKS.map((b) => [b.key, minutesOf(b.key, s, { ...n, lesson: pack.lesson?.minutes })])) as Record<StepKey, number>;
  const lessonSec = s.watch.parts.reduce((a, p) => a + Math.max(0, p.end - p.start), 0);
  const coverage = pack.lessonCoverage(s.watch.on ? s.watch.parts : []);
  const kindsOf = (f: (typeof forms)[number]) => [f.choice && `${f.choice} to choose`, f.multi && `${f.multi} select all that apply`, f.number && `${f.number} to work out`, f.reasons && `${f.reasons} with a written reason`].filter(Boolean).join(", ");
  const testText = forms.map((f) => `form ${f.form}: ${plural(f.items, "question")} (${kindsOf(f)})`).join("; ");
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
    test, // what one session answers (the pilot: both forms)
    pretest: { items: pack.pretest.length, knowledge: pack.pretest.filter((q) => q.kind === "knowledge").length },
    survey: pack.survey.length,
    scriptQuestions: pack.script?.questions.length ?? 0, // Kai's fixed questions (0: the pack has none)
    pretestSets: pack.pretestSets.filter(Boolean), // the pretest's knowledge sets (a pilot can take them all)
    coverage,
    flow,
    minutes,
    total: flow.reduce((a, k) => a + minutes[k], 0) + (s.survey.on && pack.survey.length ? 1 : 0),
    // one line per block for the Settings page, from the pack and the settings
    blocks: {
      pretest: (() => {
        // the questions a session answers: the background ones and the first set, or in a pilot every set
        const both = s.pretest.both && pack.pretestSets.length > 1;
        const n = both ? pack.pretestAll.length : pack.pretest.length;
        const knowledge = (both ? pack.pretestAll : pack.pretest).filter((q) => q.kind === "knowledge").length;
        const sets = pack.pretestSets.filter(Boolean);
        return `${plural(n, "question")} (${knowledge} on neighbouring ideas${sets.length > 1 ? (both ? `: every set, ${sets.join(" and ")}, one after the other (pilot)` : `: set ${sets[0]}`) : ""}), about ${Math.max(1, Math.round(n * 0.4))} min`;
      })(),
      watch: s.watch.parts.length ? `${plural(s.watch.parts.length, "part")} from ${plural(new Set(s.watch.parts.map((p) => p.videoId)).size, "video")}, ${mmss(lessonSec)} in all` : "no parts yet",
      teach: `${plural(lessonNodes.length, "idea")}, ${plural(facts.length, "fact")} Kai waits for; ${s.teach.fixed && pack.script ? `${plural(pack.script.questions.length, "fixed question")}, wrapping up after the last or at ${pack.script.minutes} min` : `Kai chooses its questions; usually about ${minutes.teach} min`}${s.teach.mind ? "" : "; Kai's mind hidden"}`,
      practice: `${plural(pack.practice.length, "problem")}${rounds.length > 1 ? ` in ${rounds.length} rounds (${rounds.map((r) => pack.practice.filter((p) => p.round === r).length).join(" + ")})` : ""}, ${s.practice.minutes} min`,
      exercises: `${test.both ? `both forms, one after the other (pilot), ${plural(test.items, "question")} in all; ` : ""}${testText}, about ${minutes.exercises} min`,
      results: `the score, every answer explained${s.practice.on ? ", the practice's worked solutions" : ""}`,
      survey: `${plural(pack.survey.length, "question")} after the test, before the score`,
    } as Record<StepKey | "survey", string>,
    // part of the study design: changed in code, with a reason, not mid-study
    fixed: [
      ...(pack.script ? ([["Kai's fixed questions", `${plural(pack.script.questions.length, "question")}, the same for everyone, in order; one \"can you say more?\" after a short answer, the question again once after a reply that isn't an answer (topics/${pack.slug}/script.json)`]] as [string, string][]) : []),
      ["Kai feels ready", `${s.teach.fixed && pack.script ? "with the fixed questions: after the last one; otherwise " : ""}at ${CONFIG.ready * 100}% of the ${facts.length} facts it waits for, or ${CONFIG.readyLate * 100}% after ${CONFIG.lateAfterMin} minutes of teaching (engine/tutor/policy.ts)`],
      ["Kai wraps up", `after ${CONFIG.maxTurns} learner messages (engine/tutor/policy.ts)`],
      ["Practice problems", `${plural(pack.practice.length, "problem")}, the same in both conditions (topics/${pack.slug}/practice.json)`],
      ["Final test", `${testText} (topics/${pack.slug}/exercises.json)`],
      ["Conditions", `from the access code, balanced in blocks of 4${forms.length > 1 ? (both ? "; the test form taken first alternates within each condition" : "; test forms alternate within each condition") : ""}`],
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

/** What the topic pack can't do with these settings (null: nothing), checked before every save. */
export function settingsProblem(s: Settings): string | null {
  if (!hasTopic(s.topic)) return `There is no topic pack "${s.topic}".`;
  const pack = packFor(s.topic);
  if (s.test.followUp && pack.forms.length < 2) return `The follow-up test needs two test forms, and "${pack.title}" has one. Switch it off.`;
  if (s.test.both && pack.forms.length < 2) return `Both test forms in the final test needs two forms, and "${pack.title}" has one. Switch it off.`;
  if (s.test.both && s.test.followUp) return "With both test forms in the final test, nothing is left for a follow-up test. Switch one of the two off.";
  if (s.practice.on && !pack.practice.length) return `"${pack.title}" has no practice problems: switch the practice step off.`;
  if (s.pretest.on && !pack.pretest.length) return `"${pack.title}" has no pretest: switch that step off.`;
  if (s.pretest.both && pack.pretestSets.length < 2) return `Every pretest set needs two sets, and "${pack.title}" has one. Switch it off.`;
  return null;
}
