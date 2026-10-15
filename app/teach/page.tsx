import { currentStudy } from "@/lib/server/study";
import { initialState } from "@/engine/tutor/state";
import { mindView } from "@/engine/tutor/mind";
import { opening } from "@/engine/tutor/turn";
import Teach from "@/components/Teach";

export default async function Page() {
  const { pack } = await currentStudy();
  const { bundle } = pack;
  const state = initialState(bundle);
  return <Teach opening={opening(bundle, state)} initial={state} initialMind={mindView(bundle, state)} videos={pack.videos} graph={pack.graphView} />;
}
