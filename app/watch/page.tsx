import { bundle } from "@/lib/server/content";
import Watch, { type Segment } from "@/components/Watch";

// "Channel: Video title" in topic.yaml
const channelOf = (title: string) => /^([^:]{2,30}):\s+/.exec(title)?.[1] ?? "";

/** The lesson's parts; without a `lesson` in topic.yaml, each whole video is one part. */
const segments: Segment[] = (bundle.segments.length ? bundle.segments : bundle.videos.map((v) => ({ video: v.id, videoId: v.videoId, start: 0, end: v.durationSec ?? 600, title: v.title.replace(/^[^:]{2,30}:\s+/, "") }))).map((s) => ({
  ...s,
  channel: channelOf(bundle.videos.find((v) => v.id === s.video)?.title ?? ""),
}));

export default function Page() {
  return <Watch segments={segments} />;
}
