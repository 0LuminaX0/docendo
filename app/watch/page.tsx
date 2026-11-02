import { currentStudy } from "@/lib/server/study";
import Watch, { type Segment } from "@/components/Watch";
import Read from "@/components/Read";

/** The lesson: the pack's text (lesson.json) when it has one, else the video parts from the study settings (admin
 * panel; by default the topic pack's lesson). */
export default async function Page() {
  const { settings, pack } = await currentStudy();
  if (pack.lesson) {
    const { title, minutes, minSeconds, remindSeconds, intro, sections, end } = pack.lesson;
    return <Read lesson={{ title, minutes, minSeconds, remindSeconds, intro, sections, end }} />;
  }
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
