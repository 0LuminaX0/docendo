import { currentStudy } from "@/lib/server/study";
import MindPage from "@/components/MindPage";

export const metadata = { title: "Docendo: Kai's mind" };

export default async function Page() {
  const { pack } = await currentStudy();
  return <MindPage graph={pack.graphView} />;
}
