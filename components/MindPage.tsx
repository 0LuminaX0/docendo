"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Header } from "./ui";
import MindView from "./MindView";
import { useGuard } from "./useGuard";
import { useSaved } from "@/lib/client/store";
import type { GraphView } from "@/lib/server/content";

/**
 * Kai's mind on its own page. It follows the chat live (also from another tab), since both read the same browser storage.
 * Only while teaching and after the results: during practice and the test it would show the learner what Kai
 * understood, which the recursive condition reveals only through Kai's solutions.
 */
export default function MindPage({ graph }: { graph: GraphView }) {
  const router = useRouter();
  const [saved] = useSaved();
  const allowed = useGuard(saved, "teach");
  const closed = !!saved && (saved.step === "practice" || saved.step === "exercises");
  useEffect(() => {
    if (closed && saved) router.replace(saved.step === "practice" ? "/practice" : "/exercises");
  }, [closed, saved, router]);
  if (!allowed || !saved || closed) return <div className="center">Loading…</div>;
  const back = (
    <Link className="btn small" href={saved.step === "results" ? "/results" : "/teach"}>
      <ArrowLeft size={16} /> <span className="lbl">Back to {saved.step === "results" ? "results" : "the chat"}</span>
    </Link>
  );
  return (
    <div className="shell">
      <Header phase={2} label="Kai's mind" demo={saved.demo} left={back} />
      <main className="mind-page">
        <MindView graph={graph} mind={saved.chat.mind} />
      </main>
    </div>
  );
}
