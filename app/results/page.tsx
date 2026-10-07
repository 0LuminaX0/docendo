import { publicExercises } from "@/lib/server/content";
import Results from "@/components/Results";

export default function Page() {
  return <Results items={publicExercises} />;
}
