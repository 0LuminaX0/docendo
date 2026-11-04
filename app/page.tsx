import { config } from "@/lib/server/env";
import { currentStudy, packSummary } from "@/lib/server/study";
import Intro from "@/components/Intro";
import { count, Count } from "@/lib/words";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { settings, pack } = await currentStudy();
  const sum = packSummary(pack, settings);
  // what each step card says, from the pack and the settings
  const cards = {
    watch: pack.lesson
      ? `A short text lesson on ${pack.copy.subject}, with figures, one chapter at a time. ${sum.minutes.watch} minutes.`
      : `A short video lesson on ${pack.copy.subject}${settings.watch.parts.length > 1 ? `, in ${settings.watch.parts.length} parts that play one after another` : ""}. ${sum.minutes.watch} minutes.`,
    teach: `Explain the ideas in your own words. Kai asks questions until it feels it understands. ${sum.minutes.teach} minutes.`,
    practice: `${sum.practice.rounds.length > 1 ? `${Count(sum.practice.rounds.length, "short round")} of problems` : Count(sum.practice.problems, "short problem")}${settings.practice.tries > 1 ? `, with ${count(settings.practice.tries, "try", "tries")} each` : ""}. ${sum.minutes.practice} minutes.`,
    exercises: (() => {
      const f = sum.forms[0];
      if (!f) return "Questions to see what stuck.";
      // the pilot: both forms, one after the other
      if (sum.test.both) return `Two short tests, one after the other (${count(sum.test.items, "question")} in all), to see what stuck. ${sum.minutes.exercises} minutes.`;
      const kinds = f.reasons === f.items ? ": pick an answer and say why in a sentence or two" : f.number && f.items > f.number ? ": some to choose, some to work out" : f.number ? " to work out" : " to choose";
      return `${Count(f.items, "question")} to see what stuck${kinds}. ${sum.minutes.exercises} minutes.`;
    })(),
  };
  return (
    <Intro
      accessRequired={!!config.accessCode || !!config.codeSecret || !!config.adminPassword}
      demo={config.demo}
      cards={cards}
      totalMinutes={Math.ceil(sum.total / 5) * 5}
      pretestMinutes={settings.pretest.on ? sum.minutes.pretest : 0}
      pretestItems={settings.pretest.on ? (settings.pretest.both && pack.pretestSets.length > 1 ? pack.pretestAll.length : pack.pretest.length) : 0}
      followUpOn={settings.test.followUp}
    />
  );
}
