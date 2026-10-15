import { publicPractice } from "@/lib/server/content";
import Practice from "@/components/Practice";

export const metadata = { title: "Docendo: Practice" };

// minutes and tries come from the study settings (components/SettingsContext.tsx)
export default function Page() {
  return <Practice items={publicPractice} />;
}
