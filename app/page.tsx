import { config } from "@/lib/server/env";
import { bundle } from "@/lib/server/content";
import Intro from "@/components/Intro";

export const dynamic = "force-dynamic";

export default function Page() {
  const minutes = Math.round(bundle.videos.reduce((a, v) => a + (v.durationSec ?? 0), 0) / 60);
  return <Intro topic={bundle.title} accessRequired={!!config.accessCode} demo={config.demo} parts={bundle.videos.length} videoMinutes={minutes || 25} />;
}
