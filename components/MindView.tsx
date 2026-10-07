"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Mind, MindStatus } from "@/engine/tutor/mind";
import type { Entry } from "@/engine/tutor/state";
import type { GraphView } from "@/lib/server/content";

const STATUS_TEXT: Record<MindStatus, string> = {
  off: "Not in the videos, so Kai doesn't wait for it.",
  unseen: "Not taught yet.",
  mentioned: "Touched on, but some required facts are still missing.",
  explained: "Fully explained.",
  checked: "Fully explained, and Kai checked it with a follow-up question.",
  parked: "Kai set this aside after two tries. It may come back to it later.",
};
const STATUS_NAME: Record<MindStatus, string> = {
  off: "Not in videos",
  unseen: "Not taught",
  mentioned: "Touched on",
  explained: "Explained",
  checked: "Explained + checked",
  parked: "Set aside",
};
const VERDICT: Record<Entry["verdict"], string> = { correct: "correct", partial: "partly", wrong: "wrong" };

export default function MindView({ graph, mind, notebook, popout }: { graph: GraphView; mind: Mind | null; notebook: Entry[]; popout?: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const byId = useMemo(() => new Map((mind?.nodes ?? []).map((n) => [n.id, n])), [mind]);
  const focus = mind?.nodes.find((n) => n.focus)?.id ?? null;
  const selected = sel ?? focus ?? graph.nodes[0]?.id ?? null;
  const W = graph.box.w;
  const H = graph.box.h;

  if (!mind) return <div className="center">Kai hasn&apos;t learned anything yet.</div>;
  const pct = Math.round(mind.understanding * 100);
  const node = graph.nodes.find((n) => n.id === selected);
  const ns = selected ? byId.get(selected) : undefined;
  const quotes = selected ? dedupe(notebook.filter((e) => e.fact.split(".")[0] === selected)) : [];

  return (
    <div className="mind">
      <section className="mind-top">
        <div className="mind-score">
          <div className="mind-pct">
            {pct}
            <span>%</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
            <div className="mind-title">
              <h2>Kai&apos;s understanding</h2>
              {mind.ready ? <span className="pill ok">Ready</span> : <span className="pill">Still learning</span>}
              {popout && (
                <a className="mind-pop" href="/mind" target="_blank" rel="noopener" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <ExternalLink size={14} /> Open in a new window
                </a>
              )}
            </div>
            <div className="mind-bar" role="progressbar" aria-label="Kai's understanding" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="fill" style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <p className="note">
              {fmt(mind.facts.correct + mind.facts.partial / 2)} of {mind.facts.total} facts&apos; worth ({mind.facts.correct} explained, {mind.facts.partial} partly) · ready at {mind.facts.needed} · message {mind.turn} of {mind.maxTurns}
            </p>
          </div>
        </div>
        <div className="mind-goals">
          {mind.goals.map((g) => (
            <span key={g.id} className={`goal ${g.ok ? "ok" : ""}`} title={graph.goals.find((x) => x.id === g.id)?.text}>
              <i className={`dot g-${g.id}`} />
              {g.id} {g.level}
              <b>
                {g.explained}/{g.total}
              </b>
              {g.ok ? " ✓" : ""}
            </span>
          ))}
        </div>
      </section>

      <div className="mind-canvas">
        <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} role="img" aria-label="Kai's knowledge graph">
          <defs>
            <marker id="mh" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#C3C9D2" />
            </marker>
            <marker id="mhf" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#2D7DD2" />
            </marker>
          </defs>
          {[...graph.edges]
            // highlighted edges last, so they are drawn on top
            .sort((a, b) => Number(a.from === selected || a.to === selected) - Number(b.from === selected || b.to === selected))
            .map((e) => {
              const hot = e.to === selected || e.from === selected;
              const branch = graph.nodes.find((n) => n.id === e.to)?.kind === "branch";
              return (
                <path key={`${e.from}-${e.to}`} className={`m-edge${hot ? " hot" : ""}${branch ? " br" : ""}`} markerEnd={`url(#${hot ? "mhf" : "mh"})`} d={e.d} />
              );
            })}
          {graph.nodes.map((n) => {
            const p = graph.pos[n.id]!;
            const st = byId.get(n.id);
            const status = st?.status ?? "off";
            return (
              <g
                key={n.id}
                className={`m-node s-${status}${st?.focus ? " focus" : ""}${n.id === selected ? " sel" : ""}`}
                transform={`translate(${p.x},${p.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}: ${STATUS_NAME[status]}`}
                onClick={() => setSel(n.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(n.id))}
              >
                {st?.focus && <rect className="ring" x={-5} y={-5} width={W + 10} height={H + 10} rx={14} />}
                <rect className="b" width={W} height={H} rx={10} />
                <text className="id" x={12} y={17}>
                  {n.id}
                </text>
                {st && st.total > 0 &&
                  Array.from({ length: st.total }, (_, i) => (
                    <circle key={i} className={`fd ${i < st.correct ? "c" : i < st.correct + st.partial ? "p" : ""}`} cx={42 + i * 9} cy={13} r={3.2} />
                  ))}
                <text className="lb" x={12} y={35}>
                  {n.label}
                </text>
                {n.goals.map((g, i) => (
                  <circle key={g} className={`g-${g}`} cx={W - 12 - (n.goals.length - 1 - i) * 10} cy={13} r={3.6} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mind-legend">
        {(["unseen", "mentioned", "explained", "checked", "parked", "off"] as MindStatus[]).map((s) => (
          <span key={s}>
            <i className={`sw s-${s}`} />
            {STATUS_NAME[s]}
          </span>
        ))}
        <span>
          <i className="sw focus" />
          Kai is asking about it
        </span>
        <span>
          <i className="fdot c" />
          <i className="fdot p" />
          <i className="fdot" />
          fact explained / partly / not yet
        </span>
      </div>

      <div className="mind-cols">
        <section className="mind-detail" aria-live="polite">
          {node && ns ? (
            <>
              <span className="eyebrow">
                {node.id} · {node.goals.join(", ") || "branch"}
              </span>
              <h3>{node.label}</h3>
              <p>{ns.focus ? "Kai is asking about this right now. " : ""}{STATUS_TEXT[ns.status]}</p>
              {ns.total > 0 && (
                <p className="note">
                  Required facts: {ns.correct} of {ns.total} explained{ns.partial ? `, ${ns.partial} partly` : ""}.
                </p>
              )}
              <div className="quotes">
                <span className="eyebrow">What you told Kai</span>
                {quotes.length ? (
                  quotes.map((q, i) => (
                    <blockquote key={i} className={`q-${q.verdict}`}>
                      “{q.words}” <span className={`v v-${q.verdict}`}>{VERDICT[q.verdict]}</span>
                    </blockquote>
                  ))
                ) : (
                  <p className="note">Nothing yet.</p>
                )}
              </div>
            </>
          ) : (
            <p className="note">Click an idea to see what you told Kai about it.</p>
          )}
        </section>
        <section className="mind-how">
          <h3>How Kai&apos;s understanding is scored</h3>
          <ul>
            <li>Kai waits for the <b>{mind.facts.total} required facts</b> that the videos cover. Ideas that aren&apos;t in the videos are greyed out and don&apos;t count.</li>
            <li>After each message, a judge checks which facts you explained, and must quote your own words. An explained fact counts <b>1</b>, a partly explained one <b>½</b>, and a wrong one 0 until you correct it.</li>
            <li>An idea is <b>explained</b> once all its required facts are; Kai then usually asks one follow-up to check.</li>
            <li>Kai feels <b>ready</b> at 80% ({mind.facts.needed} facts&apos; worth) once every learning goal has at least one explained idea. The bar shows progress towards that point.</li>
            <li>Kai always wraps up after {mind.maxTurns} messages.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function dedupe(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...entries].reverse()) {
    const k = e.words.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.slice(0, 6);
}
