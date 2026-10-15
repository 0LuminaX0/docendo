import { config } from "@/lib/server/env";
import { bundle } from "@/lib/server/content";
import { getSettings } from "@/lib/server/settings";
import Intro from "@/components/Intro";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { settings } = await getSettings();
  // the lesson's parts if topic.yaml has a lesson, else the whole videos
  const seconds = settings.lesson.reduce((a, s) => a + s.end - s.start, 0);
  const minutes = Math.round(seconds / 60);
  return <Intro topic={bundle.title} accessRequired={!!config.accessCode || !!config.codeSecret || !!config.adminPassword} demo={config.demo} parts={settings.lesson.length} videoMinutes={minutes || 25} practiceMinutes={settings.practiceMinutes} followUpDays={settings.delayedTestDays || null} />;
}
