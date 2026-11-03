import { currentStudy } from "@/lib/server/study";
import { initialState } from "@/engine/tutor/state";
import { mindView } from "@/engine/tutor/mind";
import { opening } from "@/engine/tutor/turn";
import { initialScriptState, scriptOpening } from "@/engine/tutor/script";
import Teach from "@/components/Teach";

export default async function Page() {
  const { pack, settings } = await currentStudy();
  const { bundle } = pack;
  // Kai's fixed questions when the pack has them and the study uses them, else Kai chooses its questions from the
  // lesson's ideas. A session keeps the way it started (its state carries the script's place)
  const script = settings.teach.fixed ? pack.script : undefined;
  const state = script ? initialScriptState(bundle, script) : initialState(bundle);
  const first = script ? scriptOpening(script) : opening(bundle, state);
  return <Teach opening={first} initial={state} initialMind={mindView(bundle, state)} videos={pack.videos} graph={pack.graphView} questions={script?.questions.length ?? 0} />;
}
