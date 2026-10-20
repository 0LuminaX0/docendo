"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDashed, CircleHelp, ExternalLink, MessageCircleQuestion, X } from "lucide-react";
import type { Mind, MindStatus, Question } from "@/engine/tutor/mind";
import type { GraphView } from "@/lib/server/content";
import { track } from "@/lib/client/log";
import { useSaved } from "@/lib/client/store";
import Quoted from "./Quoted";
import { CONFIG } from "@/engine/tutor/config";

/** 0.8 → "80%" */
const percent = (v: number) => `${Math.round(v * 100)}%`;

const STATUS_TEXT: Record<MindStatus, string> = {
  off: "Not part of this lesson, so Kai doesn't wait for it. It's here to show what the lesson connects to; if you know something about it, you can tell Kai anyway.",
  bonus: "Not part of this lesson, but you explained some of it anyway. Kai noted it; it doesn't count towards the score.",
  unseen: "Not taught yet.",
  mentioned: "Started: Kai still has questions about it.",
  explained: "Done: Kai has no more questions about it.",
  checked: "Done, and Kai checked it with one more question.",
  parked: "Set aside: Kai asked its questions, but some answers didn't settle them, so it moved on. Answer an open question below any time and the idea comes back.",
};
const STATUS_NAME: Record<MindStatus, string> = {
  off: "Not in this lesson",
  bonus: "Bonus",
  unseen: "Not taught",
  mentioned: "Started",
  explained: "Done",
  checked: "Done and checked",
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

// how far an idea has come, to tell progress from a setback
const RANK: Record<MindStatus, number> = { off: 0, unseen: 0, bonus: 1, mentioned: 1, parked: 1, explained: 2, checked: 3 };
const CHANGE_TEXT: Partial<Record<MindStatus, string>> = { mentioned: "started", explained: "done", checked: "done and checked", parked: "set aside", bonus: "noted as a bonus" };

/**
 * What changed since the learner last left Kai's mind: ideas whose status moved or that gained explained facts.
 * The picture from when the view opened is kept as the baseline while it is open (the separate page follows the
 * chat live, so changes add up); leaving the view stores the current picture for next time.
 */
function useChanges(mind: Mind | null) {
  const [saved, update] = useSaved();
  const base = useRef<Record<string, [string, number, number]> | null | undefined>(undefined);
  if (base.current === undefined && saved) base.current = saved.chat.mindSeen ?? null;
  const latest = useRef(mind);
  latest.current = mind;
  useEffect(
    () => () => {
      const m = latest.current;
      if (m) update((s) => ({ ...s, chat: { ...s.chat, mindSeen: Object.fromEntries(m.nodes.map((n) => [n.id, [n.status, n.correct, n.partial]])) } }));
    },
    [update],
  );
  return useMemo(() => {
    const b = base.current;
    if (!b || !mind) return null; // first look: nothing to compare with
    return mind.nodes
      .map((n) => {
        const [st, c, p] = b[n.id] ?? ["unseen", 0, 0];
        const moved = n.status !== st && (RANK[n.status] !== RANK[st as MindStatus] || n.status === "parked" || st === "parked");
        const more = n.correct > c || (n.correct === c && n.partial > p);
        const k = n.correct - c;
        return moved ? { id: n.id, text: CHANGE_TEXT[n.status] ?? "changed" } : more ? { id: n.id, text: k > 0 ? `${k === 1 ? "one" : k} more fact${k > 1 ? "s" : ""}` : "partly explained" } : null;
      })
      .filter((x): x is { id: string; text: string } => !!x);
  }, [mind]);
}

export default function MindView({ graph, mind, popout }: { graph: GraphView; mind: Mind | null; popout?: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null); // the idea under the pointer: its links light up softly
  const changes = useChanges(mind);
  const changed = new Set(changes?.map((c) => c.id));
  const logged = useRef(false);
  // on a narrow screen the graph scrolls sideways: start with the idea Kai is on in view
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const f = mind?.nodes.find((n) => n.focus)?.id;
    const svg = el?.querySelector("svg");
    if (!el || !f || !svg || el.scrollWidth <= el.clientWidth) return;
    const scale = svg.clientWidth / graph.width;
    el.scrollLeft = (graph.pos[f]!.x + graph.box.w / 2) * scale - el.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (changes && !logged.current) (track("mind_changes", { n: changes.length, ideas: changes.map((c) => `${c.id}:${c.text}`) }), (logged.current = true));
  }, [changes]);
  const byId = useMemo(() => new Map((mind?.nodes ?? []).map((n) => [n.id, n])), [mind]);
  const focus = mind?.nodes.find((n) => n.focus)?.id ?? null;
  const selected = sel ?? focus ?? graph.nodes[0]?.id ?? null;
  const W = graph.box.w;
  const H = graph.box.h;

  if (!mind) return <div className="center">Kai hasn&apos;t learned anything yet.</div>;
  const rank = (e: { from: string; to: string }) => (e.from === selected || e.to === selected ? 2 : e.from === hover || e.to === hover ? 1 : 0);
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
              {mind.facts.correct} of {mind.facts.total} facts explained{mind.facts.partial ? `, ${mind.facts.partial} partly` : ""}
              {mind.goals.length === 1 ? `; ${mind.goals[0]!.explained} of ${mind.goals[0]!.total} ideas done` : ""}. Kai feels ready at the end of the bar.
            </p>
          </div>
        </div>
        {/* with one goal its count is in the line above; chips (told apart by shape) only when a lesson has several */}
        {mind.goals.length > 1 && <div className="mind-goals">
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
        </div>}
      </section>

      {changes && (
        <p className="mind-new" aria-live="polite">
          {changes.length ? (
            <>
              <span className="new-tag">new</span> Since you last looked:{" "}
              {changes.map((c, i) => (
                <Fragment key={c.id}>
                  {i > 0 && "; "}
                  <button type="button" className="linkish" onClick={() => (setSel(c.id), track("mind_select", { node: c.id, via: "changes" }))}>
                    {graph.nodes.find((n) => n.id === c.id)?.label}
                  </button>
                  : {c.text}
                </Fragment>
              ))}
              .
            </>
          ) : (
            "Nothing new since you last looked."
          )}
        </p>
      )}

      <div className="mind-canvas" ref={canvas}>
        {/* scales down to the column (the whole topic is wide), but never below 760 px: narrower screens scroll */}
        <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} style={{ width: "100%", height: "auto", maxWidth: graph.width, minWidth: Math.min(graph.width, 760) }} role="img" aria-label="Kai's knowledge graph">
          <defs>
            {/* soft, rounded triangles (a filled triangle with a round-joined outline of the same colour), the tip at the
                end of the line and turned along it (orient auto); one per line colour */}
            {(
              [
                ["mh", "#AEB6C1", 11],
                ["mho", "#D3D8DF", 10],
                ["mhw", "#7FAEE3", 12],
                ["mhwo", "#B3CFEE", 11],
                ["mhf", "#2D7DD2", 12],
              ] as const
            ).map(([id, fill, size]) => (
              <marker key={id} id={id} viewBox="0 0 12 12" refX="10.6" refY="6" markerWidth={size} markerHeight={size} markerUnits="userSpaceOnUse" orient="auto">
                <path d="M2.2 2.4 L9.6 6 L2.2 9.6 Z" fill={fill} stroke={fill} strokeWidth={2.2} strokeLinejoin="round" />
              </marker>
            ))}
          </defs>
          {[...graph.edges]
            // highlighted edges last, so they are drawn on top
            .sort((a, b) => rank(a) - rank(b))
            .map((e) => {
              const hot = e.to === selected || e.from === selected;
              const warm = !hot && hover !== null && (e.to === hover || e.from === hover);
              const to = graph.nodes.find((n) => n.id === e.to);
              const branch = to?.kind === "branch";
              // edges that reach beyond the lesson are drawn faintly
              const outside = to?.inLesson === false || graph.nodes.find((n) => n.id === e.from)?.inLesson === false;
              return (
                <path key={`${e.from}-${e.to}`} className={`m-edge${hot ? " hot" : warm ? " warm" : ""}${branch ? " br" : ""}${outside ? " out" : ""}`} markerEnd={`url(#${hot ? "mhf" : warm ? (outside ? "mhwo" : "mhw") : outside ? "mho" : "mh"})`} d={e.d} />
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
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(n.id), track("mind_select", { node: n.id, status }))}
              >
                {/* one cue per meaning: the fill says how far Kai got, the dots its facts, "now" the idea Kai is on, "new" what changed */}
                <rect className="b" width={W} height={H} rx={10} />
                <text className="lb" x={12} y={st && st.total > 0 ? 20 : 28}>
                  {n.label}
                </text>
                {st && st.total > 0 &&
                  Array.from({ length: st.total }, (_, i) => (
                    <circle key={i} className={`fd ${i < st.correct ? "c" : i < st.correct + st.partial ? "p" : ""}`} cx={15.5 + i * 10} cy={33} r={3.4} />
                  ))}
                {status === "checked" && <path className="mk" d={`M${W - 22} ${H / 2} l4 4 l8 -9`} />}
                {status === "parked" && <path className="mk" d={`M${W - 20} ${H / 2 - 5} v10 M${W - 14} ${H / 2 - 5} v10`} />}
                {graph.goals.length > 1 &&
                  n.goals.map((g, i) => <GoalMark key={g} index={goalIndex(g)} size={10} x={W - 12 - (n.goals.length - 1 - i) * 13} y={12} />)}
                {changed.has(n.id) && (
                  <g className="new" transform="translate(8, -9)">
                    <rect width={34} height={18} rx={9} />
                    <text x={17} y={12.5} textAnchor="middle">
                      new
                    </text>
                  </g>
                )}
                {st?.focus && (
                  <g className="ask" transform={`translate(${W - 42}, -9)`}>
                    <rect width={38} height={18} rx={9} />
                    <text x={19} y={12.5} textAnchor="middle">
                      now
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mind-legend">
        {(["unseen", "mentioned", "explained", "checked", "parked"] as MindStatus[]).map((s) => (
          <span key={s}>
            <i className={`sw s-${s}`} />
            {STATUS_NAME[s]}
          </span>
        ))}
        <span>
          <i className="fdot c" />
          <i className="fdot p" />
          <i className="fdot" />
          Kai&apos;s facts: explained, partly, not yet
        </span>
        {focus && (
          <span>
            <i className="sw-ask">now</i>
            the idea Kai is on
          </span>
        )}
        <span>
          <i className="sw s-off" />
          Around the lesson: not needed
        </span>
        {graph.goals.length > 1 && (
          <span>
            {graph.goals.map((g, i) => (
              <GoalMark key={g.id} index={i} size={10} />
            ))}
            goals {graph.goals.map((g) => g.id.replace(/\D/g, "")).join(", ")}
          </span>
        )}
      </div>

      {/* the selected idea, full width under the graph: where it stands on the left, Kai's questions on the right */}
      <section className="mind-detail" aria-live="polite">
        {node && ns ? (
          <>
            <div className="md-side">
              <span className="eyebrow">{node.inLesson === false ? "Around the lesson" : "In the lesson"}</span>
              <h3>{node.label}</h3>
              <div className="md-state">
                <span className={`md-chip s-${ns.status}`}>
                  <i className={`sw s-${ns.status}`} />
                  {STATUS_NAME[ns.status]}
                </span>
                {ns.total > 0 && (
                  <span className="md-facts">
                    {Array.from({ length: ns.total }, (_, i) => (
                      <i key={i} className={`fdot ${i < ns.correct ? "c" : i < ns.correct + ns.partial ? "p" : ""}`} />
                    ))}
                    {ns.correct} of {ns.total} {ns.total === 1 ? "fact" : "facts"} explained{ns.partial ? `, ${ns.partial} partly` : ""}
                  </span>
                )}
              </div>
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
            </div>
            <div className="md-main">
              {questions.length > 0 || ns.unasked > 0 ? (
                <div className="qlist">
                  <span className="eyebrow">Kai&apos;s questions about this idea</span>
                  {/* questions answered by the same words share one quote */}
                  {questions.map((q, i) => {
                    const Icon = Q_ICON[q.state];
                    const sameAsNext = !!q.words && questions[i + 1]?.words === q.words;
                    return (
                      <div key={i} className={`qi qi-${q.state}${sameAsNext ? " joined" : ""}`}>
                        <Icon size={16} strokeWidth={2.4} aria-hidden="true" />
                        <div>
                          {q.ask ? <p className="qq">{q.ask}</p> : <p className="qq extra">Something extra you explained</p>}
                          {!sameAsNext && q.words && (
                            <blockquote className={q.note ? "noted" : ""}>
                              {q.note ? <Quoted text={q.note} quote={q.words} /> : <>“{q.words}”</>}
                            </blockquote>
                          )}
                          {!sameAsNext && <span className={`v v-${q.state}`}>{Q_TEXT[q.state]}</span>}
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
              ) : (
                <p className="note md-empty">You haven&apos;t told Kai anything about this yet.</p>
              )}
            </div>
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
          <li>
            Kai feels <b>ready</b> at {percent(CONFIG.ready)} ({mind.facts.needed} facts&apos; worth), or at {percent(CONFIG.readyLate)} once you have been teaching for {CONFIG.lateAfterMin} minutes, as long as at least one idea is fully explained. The bar shows progress towards {percent(CONFIG.ready)}.
          </li>
          <li>Kai always wraps up after {mind.maxTurns} messages.</li>
        </ul>
      </details>
    </div>
  );
}
