import { currentStudy } from "@/lib/server/study";
import Practice from "@/components/Practice";

export const metadata = { title: "Docendo: Practice" };

// minutes and tries come from the study settings (components/SettingsContext.tsx)
export default async function Page() {
  const { pack } = await currentStudy();
  return <Practice items={pack.publicPractice} />;
}
