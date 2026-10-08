import { publicPretest } from "@/lib/server/content";
import Pretest from "@/components/Pretest";

export const metadata = { title: "Docendo: Before you start" };

export default function Page() {
  return <Pretest items={publicPretest} />;
}
