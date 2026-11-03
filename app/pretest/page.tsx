import { currentStudy } from "@/lib/server/study";
import Pretest from "@/components/Pretest";

export const metadata = { title: "Docendo: Before you start" };

export default async function Page() {
  const { settings, pack } = await currentStudy();
  // every set's questions: the page shows the session's sets (the first one, or in a pilot all of them, in its order)
  return <Pretest items={pack.publicPretest} both={settings.pretest.both} />;
}
