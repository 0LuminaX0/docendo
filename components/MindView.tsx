"use client";

import { useMemo, useState } from "react";
import { Check, CircleDashed, CircleHelp, ExternalLink, MessageCircleQuestion, X } from "lucide-react";
import type { Mind, MindStatus, Question } from "@/engine/tutor/mind";
import type { GraphView } from "@/lib/server/content";
import { track } from "@/lib/client/log";

const STATUS_TEXT: Record<MindStatus, string> = {
  off: "Not in the videos, so Kai doesn't wait for it.",
  bonus: "Not in the videos, but you explained some of it anyway. Kai noted it; it doesn't count towards the score.",
  unseen: "Not taught yet.",
  mentioned: "Started: Kai still has questions about it.",
  explained: "Done: Kai has no more questions about it.",
  checked: "Done, and Kai checked it with one more question.",
  parked: "Set aside: Kai asked its questions, but some answers didn't settle them, so it moved on. Answer an open question below any time and the idea comes back.",
};
const STATUS_NAME: Record<MindStatus, string> = {
  off: "Not in videos",
  bonus: "Bonus",
  unseen: "Not taught",
  mentioned: "Started",
  explained: "Done",
  checked: "Done + checked",
  parked: "Set aside",
};
const Q_TEXT: Record<Question["state"], string> = {
  answered: "got it",
  partly: "partly",
  wrong: "doesn't fit",
  asked: "still open",
  current: "asking now",
};
const Q_ICON: Record<Question["state"], typeof Check> = { answered: Check, partly: CircleDashed, wrong: X, asked: CircleHelp, current: MessageCircleQuestion };

/** Learning goals are told apart by shape (and colour), so circles only ever mean facts. */
export function GoalMark({ index, size = 10, x, y }: { index: number; size?: number; x?: number; y?: number }) {
  const h = size / 2;
  const d = [
    `M0 ${-h} L${h} ${h * 0.8} L${-h} ${h * 0.8} Z`, // triangle
    `M${-h * 0.82} ${-h * 0.82} H${h * 0.82} V${h * 0.82} H${-h * 0.82} Z`, // square
    `M0 ${-h} L${h} 0 L0 ${h} L${-h} 0 Z`, // diamond
    `M0 ${-h} L${h} ${-h * 0.2} L${h * 0.6} ${h} L${-h * 0.6} ${h} L${-h} ${-h * 0.2} Z`, // pentagon
  ][index % 4];
  const shape = <path className={`gm gm-${index % 4}`} d={d} />;
  if (x !== undefined && y !== undefined) return <g transform={`translate(${x},${y})`}>{shape}</g>;
  return (
    <svg className="gmark" width={size} height={size} viewBox={`${-h} ${-h} ${size} ${size}`} aria-hidden="true">
      {shape}
    </svg>
  );
}

export default function MindView({ graph, mind, popout }: { graph: GraphView; mind: Mind | null; popout?: boolean }) {
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
  const goalIndex = (id: string) => Math.max(0, graph.goals.findIndex((g) => g.id === id));
  const questions = ns?.questions ?? []; // older saved sessions have no question list

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
              {pct}% of what Kai needs to feel ready · {mind.facts.correct} facts explained{mind.facts.partial ? `, ${mind.facts.partial} partly` : ""}, of {mind.facts.total} · message {mind.turn} of {mind.maxTurns}
            </p>
          </div>
        </div>
        <div className="mind-goals">
          {mind.goals.map((g) => (
            <span key={g.id} className={`goal ${g.ok ? "ok" : ""}`} title={graph.goals.find((x) => x.id === g.id)?.text}>
              <GoalMark index={goalIndex(g.id)} size={11} />
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
                onClick={() => (setSel(n.id), track("mind_select", { node: n.id, status }))}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(n.id), track("mind_select", { node: n.id, status }))}
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
                  <GoalMark key={g} index={goalIndex(g)} size={10} x={W - 12 - (n.goals.length - 1 - i) * 13} y={13} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mind-legend">
        {(["unseen", "mentioned", "explained", "checked", "parked", "off", "bonus"] as MindStatus[]).map((s) => (
          <span key={s}>
            <i className={`sw s-${s}`} />
            {STATUS_NAME[s]}
          </span>
        ))}
        <span>
          <i className="sw focus" />
          Kai&apos;s focus
        </span>
        <span>
          <i className="fdot c" />
          <i className="fdot p" />
          <i className="fdot" />
          facts: explained, partly, not yet
        </span>
        <span>
          {graph.goals.map((g, i) => (
            <GoalMark key={g.id} index={i} size={10} />
          ))}
          goals {graph.goals.map((g) => g.id.replace(/\D/g, "")).join(", ")}
        </span>
      </div>

      <section className="mind-detail" aria-live="polite">
          {node && ns ? (
            <>
              <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {node.id}
                {node.goals.map((g) => (
                  <GoalMark key={g} index={goalIndex(g)} size={9} />
                ))}
                {node.goals.length ? node.goals.join(", ") : "branch"}
              </span>
              <h3>{node.label}</h3>
              <p>{STATUS_TEXT[ns.status]}</p>
              {ns.asking && (
                <div className="asking">
                  <MessageCircleQuestion size={18} aria-hidden="true" />
                  <div>
                    <span className="eyebrow">Kai is asking</span>
                    <p>{ns.asking}</p>
                  </div>
                </div>
              )}
              {(questions.length > 0 || ns.unasked > 0) && (
                <div className="qlist">
                  <span className="eyebrow">Kai&apos;s questions about this idea</span>
                  {questions.map((q, i) => {
                    const Icon = Q_ICON[q.state];
                    return (
                      <div key={i} className={`qi qi-${q.state}`}>
                        <Icon size={16} strokeWidth={2.4} aria-hidden="true" />
                        <div>
                          {q.ask ? <p className="qq">{q.ask}</p> : <p className="qq extra">Something extra you explained</p>}
                          {q.words && <blockquote>“{q.words}”</blockquote>}
                          <span className={`v v-${q.state}`}>{Q_TEXT[q.state]}</span>
                        </div>
                      </div>
                    );
                  })}
                  {ns.unasked > 0 && (
                    <p className="note">
                      {questions.length ? "And " : ""}
                      {ns.unasked} more {ns.unasked === 1 ? "thing" : "things"} Kai doesn&apos;t know yet. It asks one at a time, or you can explain ahead.
                    </p>
                  )}
                </div>
              )}
              {!questions.length && !ns.unasked && <p className="note">You haven&apos;t told Kai anything about this yet.</p>}
            </>
          ) : (
            <p className="note">Click an idea to see what you told Kai about it.</p>
          )}
      </section>

      <details className="mind-how" onToggle={(e) => track("scoring_toggle", { open: (e.currentTarget as HTMLDetailsElement).open })}>
        <summary>How Kai&apos;s understanding is scored</summary>
        <ul>
          <li>Kai waits for the <b>{mind.facts.total} facts</b> that the videos cover. Ideas that aren&apos;t in the videos are greyed out and don&apos;t count.</li>
          <li>Kai asks about one fact at a time. After each message, a judge checks which facts you explained, and must quote your own words. An explained fact counts <b>1</b>, a partly explained one <b>½</b>, and a wrong one 0 until you correct it.</li>
          <li>If an answer only partly lands, Kai asks once more; then it moves on and the question stays open here. An idea is <b>done</b> once Kai has no questions left about it.</li>
          <li>Kai feels <b>ready</b> at 80% ({mind.facts.needed} facts&apos; worth), or at 50% once you have been teaching for 8 minutes, as long as at least one idea is fully explained. The bar shows progress towards 80%.</li>
          <li>Kai always wraps up after {mind.maxTurns} messages.</li>
        </ul>
      </details>
    </div>
  );
}
