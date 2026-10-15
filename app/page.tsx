import { config } from "@/lib/server/env";
import { currentStudy, packSummary } from "@/lib/server/study";
import Intro from "@/components/Intro";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { settings, pack } = await currentStudy();
  const sum = packSummary(pack, settings);
  // what each step card says, from the pack and the settings
  const cards = {
    watch: `A short video lesson on ${pack.copy.subject}${settings.watch.parts.length > 1 ? `, in ${settings.watch.parts.length} parts that play one after another` : ""}. About ${sum.minutes.watch} minutes.`,
    teach: `Explain the ideas in your own words. Kai asks questions until it feels it understands. About ${sum.minutes.teach} minutes.`,
    practice: `${sum.practice.rounds.length > 1 ? `${sum.practice.rounds.length === 2 ? "Two" : sum.practice.rounds.length} short rounds of problems` : `${sum.practice.problems} short problems`}${settings.practice.tries > 1 ? `, with ${settings.practice.tries === 2 ? "two" : settings.practice.tries} tries each` : ""}. ${settings.practice.minutes} minutes.`,
    exercises: (() => {
      const f = sum.forms[0];
      if (!f) return "Questions to see what stuck.";
      const kinds = f.choice && f.number ? ": some to choose, some to work out" : f.number ? " to work out" : " to choose";
      return `${f.items} questions to see what stuck${kinds}. About ${sum.minutes.exercises} minutes.`;
    })(),
  };
  return (
    <Intro
      accessRequired={!!config.accessCode || !!config.codeSecret || !!config.adminPassword}
      demo={config.demo}
      cards={cards}
      totalMinutes={Math.round(sum.total / 5) * 5}
      pretestItems={settings.pretest.on ? pack.pretest.length : 0}
      followUpDays={settings.test.followUpDays || null}
    />
  );
}
