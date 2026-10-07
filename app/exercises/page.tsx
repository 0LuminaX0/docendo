import { publicExercises } from "@/lib/server/content";
import Exercises from "@/components/Exercises";

export default function Page() {
  return <Exercises items={publicExercises} />;
}
