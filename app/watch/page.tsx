import { videos } from "@/lib/server/content";
import Watch from "@/components/Watch";

export default function Page() {
  return <Watch videos={videos} />;
}
