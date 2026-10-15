import { bundle } from "@/lib/server/content";
import { getSettings } from "@/lib/server/settings";
import Watch, { type Segment } from "@/components/Watch";

/** The lesson's parts, from the study settings (admin panel; by default topic.yaml's lesson). */
export default async function Page() {
  const { settings } = await getSettings();
  const segments: Segment[] = settings.lesson.map((p) => ({
    video: bundle.videos.find((v) => v.videoId === p.videoId)?.id ?? p.videoId,
    videoId: p.videoId,
    start: p.start,
    end: p.end,
    title: p.title,
    channel: p.channel,
  }));
  return <Watch segments={segments} />;
}
