import { graphView } from "@/lib/server/content";
import MindPage from "@/components/MindPage";

export const metadata = { title: "Kai's mind · Docendo" };

export default function Page() {
  return <MindPage graph={graphView} />;
}
