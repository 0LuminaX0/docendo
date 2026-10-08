"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "./ui";
import MindView from "./MindView";
import { useGuard } from "./useGuard";
import { useSaved } from "@/lib/client/store";
import type { GraphView } from "@/lib/server/content";

/** Kai's mind on its own page. It follows the chat live (also from another tab), since both read the same browser storage. */
export default function MindPage({ graph }: { graph: GraphView }) {
  const [saved] = useSaved();
  const allowed = useGuard(saved, "teach");
  if (!allowed || !saved) return <div className="center">Loading…</div>;
  const back = (
    <Link className="btn small" href={saved.step === "results" ? "/results" : saved.step === "exercises" ? "/exercises" : saved.step === "practice" ? "/practice" : "/teach"}>
      <ArrowLeft size={16} /> <span className="lbl">Back to {saved.step === "results" ? "results" : saved.step === "exercises" ? "the test" : saved.step === "practice" ? "practice" : "the chat"}</span>
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
