"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import Scratchpad from "./Scratchpad";
import { useStudySettings } from "./SettingsContext";
import { Header } from "./ui";
import { useGuard } from "./useGuard";
import { Count } from "@/lib/words";
import { post, save, useSaved, type GradeResult, type TestItem } from "@/lib/client/store";
import { track } from "@/lib/client/log";
import { seedOf, testOrder, testParts as parts } from "@/lib/order";
export { parts };
import { DONT_KNOW, reasonGiven, type TestAnswer } from "@/lib/answers";

export type { TestItem };
const KEYS = "ABCDEF";
export const REASON_PROMPT = "Explain your choice in one or two sentences.";

/**
 * The final test, laid out like a practice problem: the question (with a table under it, if it has one), then the
 * options or a box for a number, and a field under it: the reason in a sentence or two when the item asks for one,
 * else the working (the same field as in practice, with the calculator built in). An item may offer "I don't know"
 * (graded wrong), and a multi-select item takes every true statement. Graded on the server.
 *
 * The questions come from the server for this session (lib/order.ts orders them per learner, kept in the session and
 * logged): one form (A or B), or in a pilot both forms as two parts, the session's own form first. The second part
 * opens once the first is complete, and then the first can't be changed. The delayed test (a session of its own, days
 * later) takes the other form and asks first whether the learner has studied the topic since.
 */
const SINCE = [
  ["no", "No"],
  ["a little", "A little (for example a quick look at my notes)"],
  ["a lot", "Yes, quite a bit (videos, reading, a course)"],
] as const;

/** Whether an item counts as answered: an answer, and its reason when it asks for one ("I don't know" needs none). */
export function isAnswered(q: TestItem, a: TestAnswer | undefined, reason: string | undefined): boolean {
  if (a === null || a === undefined || (typeof a === "string" && !a.trim()) || (Array.isArray(a) && !a.length)) return false;
  return !q.reason || a === DONT_KNOW || reasonGiven(reason);
}

export default function Exercises() {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "exercises");
  const { calculator, copy } = useStudySettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useTestItems(allowed, setError);
  // this learner's order, fixed the first time the test opens
  const order = items && saved?.testOrder?.length === items.length ? saved.testOrder : null;
  useEffect(() => {
    if (!allowed || !saved || !items || order) return;
    const o = testOrder(items, seedOf(saved.token));
    update((s) => ({ ...s, testOrder: o }));
    track("test_order", { order: o });
  }, [allowed, saved, order, items, update]);
  if (!allowed || !saved || !items || !order) return <div className="center">{error ?? "Loading…"}</div>;
  const delayed = saved.phase === "delayed";
  const sections = parts(items, order);
  const groups = Math.max(1, ...sections.map((p) => p.group + 1));
  const current = Math.min(saved.testPart ?? 0, groups - 1); // the part being answered; earlier ones are locked
  // the test's shape, from its items: two parts when it has both kinds
  const kinds = new Set(items.map((q) => (q.kind === "number" ? "number" : "choice")));
  const shape = kinds.size > 1 ? "two parts: first pick an option, then work out a number" : null;
  const reasons = items.every((q) => q.reason);
  const dontKnow = items.some((q) => q.dontKnow);

  const answers = items.map((_, i) => saved.answers[i] ?? null);
  const done = (i: number) => isAnswered(items[i]!, answers[i], saved.testWork?.[items[i]!.id]);
  const answered = items.filter((_, i) => done(i)).length + (delayed && saved.since ? 1 : 0);
  const total = items.length + (delayed ? 1 : 0);
  const inGroup = (g: number) => sections.filter((p) => p.group === g).flatMap((p) => p.list);
  const groupDone = (g: number) => inGroup(g).every(({ i }) => done(i)) && (!delayed || g > 0 || !!saved.since);
  const setAnswer = (i: number, a: TestAnswer) =>
    update((s) => {
      const next = items.map((_, j) => s.answers[j] ?? null);
      next[i] = a;
      return { ...s, answers: next };
    });
  // an option, "I don't know", or (unticking "I don't know" on a multi-select item) nothing
  const choose = (i: number, k: number | typeof DONT_KNOW | null) => {
    track("test_option", { q: items[i]!.id, k, changed: saved.answers[i] != null && saved.answers[i] !== k });
    setAnswer(i, k);
  };
  // multi-select: tick or untick a statement ("I don't know" clears the ticks, a tick clears "I don't know")
  const tick = (i: number, k: number) => {
    const a = answers[i];
    const was = Array.isArray(a) ? a : [];
    const next = was.includes(k) ? was.filter((x) => x !== k) : [...was, k].sort((x, y) => x - y);
    track("test_option", { q: items[i]!.id, k, on: !was.includes(k) });
    setAnswer(i, next.length ? next : null);
  };
  const setWork = (id: string, v: string) => update((s) => ({ ...s, testWork: { ...s.testWork, [id]: v } }));

  function nextPart() {
    if (!groupDone(current)) return;
    track("test_part", { part: current + 1, of: groups, answered });
    update((s) => ({ ...s, testPart: current + 1 }));
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!saved) return;
    setBusy(true);
    setError(null);
    track("test_submit", { answered });
    const work = Object.fromEntries(Object.entries(saved.testWork ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.slice(0, 2000)]));
    const sent = answers.map((a) => (typeof a === "string" && a !== DONT_KNOW ? a.trim().slice(0, 40) || null : a));
    const r = await post<GradeResult>("/api/grade", { token: saved.token, answers: sent, work, order, ...(delayed ? { since: saved.since } : {}) });
    setBusy(false);
    if (!r.ok) {
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      return setError(r.error);
    }
    update((s) => ({ ...s, result: r.data, step: "results", finishedAt: Date.now() }));
    router.push("/results");
  }

  const how = reasons
    ? `For each, pick the answer you think is right${dontKnow ? " (or “I don't know”)" : ""} and explain your choice in one or two sentences.`
    : `Work things out under each question if it helps${calculator ? "; to calculate, end a calculation with =" : ""}.`;
  const lede = delayed
    ? `Welcome back. ${Count(items.length, "new question")} on the same ideas as last time${shape ? `, in the same ${shape}` : ""}. ${reasons ? how : calculator ? "To calculate, end a calculation with =." : ""} You'll see the explanations afterwards.`
    : groups > 1
      ? `${Count(groups, "part")}, one after the other, ${Count(items.length, "question")} in all. ${how} Once you go on to the next part, your answers to the one before can't be changed. You'll see the explanations at the end.`
      : `${Count(items.length, "question")}${shape ? ` in ${shape}` : ""}. ${how} You'll see the explanations afterwards.`;

  return (
    <div className="shell">
      <Header step="exercises" demo={saved.demo} label={delayed ? "Follow-up test" : undefined} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 className="title" style={{ fontSize: "clamp(24px, 3vw, 30px)" }}>{delayed ? "Follow-up test" : "Final test"}</h1>
          <p className="lede" style={{ fontSize: 15.5 }}>{lede}</p>
        </div>
        {delayed && (
          <fieldset className="opts since" aria-labelledby="since-q">
            <p className="qt" id="since-q">
              First: since your session, have you looked at {copy.subject} again (videos, notes, reading, a course)?
            </p>
            {SINCE.map(([v, text]) => (
              <label className="opt" key={v}>
                <input type="radio" name="since" checked={saved.since === v} onChange={() => (update((s) => ({ ...s, since: v })), track("test_since", { since: v }))} />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="quiz">
          {/* parts already done: locked, one line each */}
          {Array.from({ length: current }, (_, g) => (
            <p className="quiz-done" key={`done-${g}`}>
              <Check size={16} strokeWidth={2.6} aria-hidden="true" /> <b>Part {g + 1} of {groups} done.</b> <span className="note">{Count(inGroup(g).length, "answer")} saved; they can&apos;t be changed now.</span>
            </p>
          ))}
          {sections
            .filter((p) => p.group === current)
            .map(({ title, start, list }) => (
              <section key={title || "items"} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {title && <h2 className="quiz-section">{title}</h2>}
                <ol start={start + 1} style={{ counterReset: `q ${start}` }}>
                  {list.map(({ q, i }, j) => (
                    <Question key={q.id} q={q} n={start + j + 1} a={answers[i]!} work={saved.testWork?.[q.id] ?? ""} onChoose={(k) => choose(i, k)} onTick={(k) => tick(i, k)} onAnswer={(v) => setAnswer(i, v)} onWork={(v) => setWork(q.id, v)} />
                  ))}
                </ol>
              </section>
            ))}
        </div>
        <div className="submitbar">
          {current < groups - 1 ? (
            <button className="btn primary" onClick={nextPart} disabled={!groupDone(current)}>
              Go on to part {current + 2} <ArrowRight size={17} strokeWidth={2.6} />
            </button>
          ) : (
            <button className="btn primary" onClick={() => void submit()} disabled={busy || answered < total}>
              {busy ? "Checking…" : <><Check size={17} strokeWidth={2.6} /> Check my answers</>}
            </button>
          )}
          <span className="answered">
            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(answered / total) * 100}%` }} /></span>
            {answered} of {total} answered
          </span>
          {current < groups - 1 && <span className="note">Part {current + 1} can&apos;t be changed after this.</span>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
    </div>
  );
}

/** One question: the prompt (and its table), the options or the number box, and the reason or working under it. */
function Question({ q, n, a, work, onChoose, onTick, onAnswer, onWork }: { q: TestItem; n: number; a: TestAnswer; work: string; onChoose: (k: number | typeof DONT_KNOW | null) => void; onTick: (k: number) => void; onAnswer: (v: string) => void; onWork: (v: string) => void }) {
  const labelled = q.question ? `${q.id}-q ${q.id}-q2` : `${q.id}-q`;
  const field = q.reason ? (
    <div className="qwork qreason">
      <p className="qreason-label" id={`${q.id}-why`}>{REASON_PROMPT}</p>
      <Scratchpad id={`${q.id}-work`} where={`test:${q.id}`} label={`${REASON_PROMPT} (question ${n})`} value={work} onChange={onWork} rows={2} placeholder={a === DONT_KNOW ? "Optional when you don't know" : "Because…"} />
      {a !== null && a !== DONT_KNOW && !reasonGiven(work) && <p className="note qreason-hint">Add a short reason (a few words at least) to count this question as answered.</p>}
    </div>
  ) : (
    <div className="qwork">
      <Scratchpad
        id={`${q.id}-work`}
        where={`test:${q.id}`}
        label={`Your working for question ${n}`}
        value={work}
        onChange={onWork}
        rows={2}
        placeholder="Work it out here if it helps"
        onUse={q.kind === "number" ? (v) => onAnswer(String(Math.round(v * 1000) / 1000)) : undefined}
      />
    </div>
  );
  const dontKnow = q.dontKnow && (
    <label className="opt idk">
      <input type={q.kind === "multi" ? "checkbox" : "radio"} name={q.id} checked={a === DONT_KNOW} onChange={() => onChoose(q.kind === "multi" && a === DONT_KNOW ? null : DONT_KNOW)} />
      <span className="key" aria-hidden="true">?</span>
      <span>I don&apos;t know</span>
    </label>
  );
  return (
    <li className="q" data-q={q.id}>
      <div className="qt" id={`${q.id}-q`}>
        <p>{q.prompt}</p>
        {q.table && <TestTable table={q.table} />}
        {q.question && <p id={`${q.id}-q2`}>{q.question}</p>}
      </div>
      {q.kind === "number" ? (
        <label className="pans qans">
          <span>Answer</span>
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            maxLength={40}
            value={typeof a === "string" && a !== DONT_KNOW ? a : ""}
            onChange={(e) => onAnswer(e.target.value)}
            onBlur={(e) => e.target.value && track("test_number", { q: q.id, answer: e.target.value.slice(0, 40) })}
          />
          {q.unit && <span className="unit">{q.unit}</span>}
        </label>
      ) : q.kind === "multi" ? (
        <fieldset className="opts multi" aria-labelledby={labelled}>
          {(q.options ?? []).map((o, k) => (
            <label className="opt" key={k}>
              <input type="checkbox" checked={Array.isArray(a) && a.includes(k)} onChange={() => onTick(k)} />
              <span className="key" aria-hidden="true">{KEYS[k]}</span>
              <span>{o}</span>
            </label>
          ))}
          {dontKnow}
        </fieldset>
      ) : (
        <fieldset className="opts" aria-labelledby={labelled}>
          {(q.options ?? []).map((o, k) => (
            <label className="opt" key={k}>
              <input type="radio" name={q.id} checked={a === k} onChange={() => onChoose(k)} />
              <span className="key" aria-hidden="true">{KEYS[k]}</span>
              <span>{o}</span>
            </label>
          ))}
          {dontKnow}
        </fieldset>
      )}
      {field}
    </li>
  );
}

/** A small table in a question (a log of shares, say). */
export function TestTable({ table }: { table: { head: string[]; rows: string[][] } }) {
  return (
    <div className="qtable-wrap">
      <table className="qtable">
        <thead>
          <tr>{table.head.map((h, k) => <th key={k} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, k) => (
            <tr key={k}>{r.map((c, m) => (m === 0 ? <th key={m} scope="row">{c}</th> : <td key={m}>{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** This session's questions (its form, or both in a pilot), fetched once from the server and kept in the session. */
export function useTestItems(allowed: boolean, onError: (e: string) => void): TestItem[] | null {
  const router = useRouter();
  const [saved, update] = useSaved();
  useEffect(() => {
    if (!allowed || !saved || saved.testItems) return;
    void post<{ items: TestItem[] }>("/api/grade", { token: saved.token, kind: "items" }).then((r) => {
      if (r.ok) update((s) => ({ ...s, testItems: r.data.items }));
      else if (r.expired) (save(null), router.replace("/"));
      else onError(r.error);
    });
  }, [allowed, saved, update, router, onError]);
  return saved?.testItems ?? null;
}
