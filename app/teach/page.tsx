import { bundle, graphView, videos } from "@/lib/server/content";
import { initialState } from "@/engine/tutor/state";
import { mindView } from "@/engine/tutor/mind";
import { opening } from "@/engine/tutor/turn";
import Teach from "@/components/Teach";

export default function Page() {
  const state = initialState(bundle);
  return <Teach opening={opening(bundle, state)} initial={state} initialMind={mindView(bundle, state)} videos={videos} graph={graphView} />;
}
