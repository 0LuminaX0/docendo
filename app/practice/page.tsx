import { practiceMinutes, publicPractice } from "@/lib/server/content";
import Practice from "@/components/Practice";

export const metadata = { title: "Docendo: Practice" };

export default function Page() {
  return <Practice items={publicPractice} minutes={practiceMinutes} />;
}
