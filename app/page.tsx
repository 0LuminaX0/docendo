import { config } from "@/lib/server/env";
import { bundle, practiceMinutes } from "@/lib/server/content";
import Intro from "@/components/Intro";

export const dynamic = "force-dynamic";

export default function Page() {
  // the lesson's parts if topic.yaml has a lesson, else the whole videos
  const seconds = bundle.segments.length ? bundle.segments.reduce((a, s) => a + s.end - s.start, 0) : bundle.videos.reduce((a, v) => a + (v.durationSec ?? 0), 0);
  const minutes = Math.round(seconds / 60);
  return <Intro topic={bundle.title} accessRequired={!!config.accessCode || !!config.codeSecret} demo={config.demo} parts={bundle.segments.length || bundle.videos.length} videoMinutes={minutes || 25} practiceMinutes={practiceMinutes} />;
}
