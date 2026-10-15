import { currentStudy } from "@/lib/server/study";
import Pretest from "@/components/Pretest";

export const metadata = { title: "Docendo: Before you start" };

export default async function Page() {
  const { pack } = await currentStudy();
  return <Pretest items={pack.publicPretest} />;
}
