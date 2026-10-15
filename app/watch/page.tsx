import { currentStudy } from "@/lib/server/study";
import Watch, { type Segment } from "@/components/Watch";

/** The lesson's parts, from the study settings (admin panel; by default the topic pack's lesson). */
export default async function Page() {
  const { settings, pack } = await currentStudy();
  const segments: Segment[] = settings.watch.parts.map((p) => ({
    video: pack.bundle.videos.find((v) => v.videoId === p.videoId)?.id ?? p.videoId,
    videoId: p.videoId,
    start: p.start,
    end: p.end,
    title: p.title,
    channel: p.channel,
  }));
  return <Watch segments={segments} />;
}
