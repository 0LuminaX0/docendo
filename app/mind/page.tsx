import { graphView } from "@/lib/server/content";
import MindPage from "@/components/MindPage";

export const metadata = { title: "Docendo: Kai's mind" };

export default function Page() {
  return <MindPage graph={graphView} />;
}
