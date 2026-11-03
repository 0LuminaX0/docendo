import { currentStudy } from "@/lib/server/study";
import { initialState } from "@/engine/tutor/state";
import { mindView } from "@/engine/tutor/mind";
import { opening } from "@/engine/tutor/turn";
import { initialScriptState, scriptOpening } from "@/engine/tutor/script";
import Teach from "@/components/Teach";

export default async function Page() {
  const { pack } = await currentStudy();
  const { bundle } = pack;
  // Kai's fixed questions when the pack has them, else Kai chooses its questions from the lesson's ideas
  const state = pack.script ? initialScriptState(bundle, pack.script) : initialState(bundle);
  const first = pack.script ? scriptOpening(pack.script) : opening(bundle, state);
  return <Teach opening={first} initial={state} initialMind={mindView(bundle, state)} videos={pack.videos} graph={pack.graphView} />;
}
