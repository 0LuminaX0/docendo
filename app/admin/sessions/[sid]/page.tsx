import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { keyText, packFor } from "@/lib/server/content";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: session", robots: { index: false, follow: false } };

type Ev = Record<string, unknown> & { t: string; at: string };
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));
const LETTERS = "ABCDEF";
/** 0.75 (minutes) → "0:45" */
const mmss = (min: unknown) => (typeof min === "number" && Number.isFinite(min) ? `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, "0")}` : "–");
const when = (iso: unknown) => (typeof iso === "string" ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "–");

/** An option as the learner saw it: its letter in a key, then its text. */
function Option({ i, text }: { i: number; text?: string }) {
  return (
    <>
      <span className="sd-letter">{LETTERS[i] ?? "?"}</span> {text ?? ""}
    </>
  );
}

function Verdict({ ok, children }: { ok: boolean | null; children?: React.ReactNode }) {
  return <span className={`adm-pill ${ok === null ? "" : ok ? "ok" : "bad"}`}>{children ?? (ok === null ? "–" : ok ? "right" : "wrong")}</span>;
}

/**
 * One session as it happened, read from the research log: who and under which setup, how long each step took, the
 * pretest and the final test with the question text and the learner's answers beside the keys (from the session's own
 * topic pack), the whole teaching chat with the judge's verdicts, the practice (the learner's tries, or Kai's attempts
 * with what Kai's gate found and the learner's call), the questions after the test, feedback and every event.
 */
export default async function Page({ params }: { params: Promise<{ sid: string }> }) {
  await requireAdmin();
  const { sid } = await params;
  const t = await loadTables();
  const evs = t.events.filter((e) => e.sid === sid) as Ev[];
  const s = t.sessions.find((x) => x.sid === sid);
  if (!s || !evs.length) notFound();
  const pack = packFor(String(s.topic ?? ""));
  const factLabel = (id: string) => {
    const n = pack.bundle.nodes.find((x) => x.id === id.split(".")[0]);
    return n ? `${n.label} (${id})` : id;
  };
  const t0 = Date.parse(evs[0]!.at);
  const off = (e: Ev) => {
    const sec = Math.max(0, Math.round(((typeof e.clientAt === "number" ? e.clientAt : Date.parse(e.at)) - t0) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const of = (type: string) => evs.filter((e) => e.t === type);
  const start = of("session_start")[0];
  const pre = of("pretest")[0];
  const chat = of("chat_turn");
  const grade = of("grade")[0];
  const feedback = of("client_feedback");
  const survey = of("client_survey")[0];
  const calls = of("client_practice_kai_call");
  const rec = String(s.practiceView ?? s.condition) === "recursive";
  const device = start?.device as { browser?: string; os?: string; mobile?: boolean } | undefined;

  // practice, problem by problem, in the pack's order
  const problems = pack.practice
    .map((p) => ({ p, checks: of("practice_check").filter((e) => e.id === p.id), kai: evs.filter((e) => (e.t === "practice_kai_solve" || e.t === "practice_kai_reteach") && e.id === p.id), skipped: of("client_practice_skip").some((e) => e.id === p.id) }))
    .filter((x) => x.checks.length || x.kai.length || x.skipped);

  // the final test, in the order the learner saw it
  const gradeItems = (grade?.items as { id: string; kind?: string; chosen: number | string | null; correct: boolean; pos?: number | null; work?: string | null }[]) ?? [];
  const testRows = [...gradeItems].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)).map((x) => ({ x, q: pack.exercises.find((q) => q.id === x.id) }));

  const steps = [
    ["Pretest", s.minPretest],
    ["Watch", s.minWatch],
    ["Teach", s.minTeach],
    ["Practice", s.minPractice],
    ["Test", s.minTest],
  ] as const;
  const longest = Math.max(1, ...steps.map(([, m]) => (typeof m === "number" ? m : 0)));

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <p className="note">
            <Link href="/admin/sessions?scope=all">Sessions</Link>
          </p>
          <h1>Session {String(s.pid ?? sid.slice(0, 8))}</h1>
          <p className="sd-meta">
            <span className={`adm-pill ${rec ? "rec" : "dir"}`}>{rec ? "recursive" : "direct"}</span>
            <span>{str(s.entry)}{s.demo ? ", demo" : ""}</span>
            {s.phase === "delayed" && <span>follow-up test</span>}
            <span>{pack.title}, form {str(s.form)}</span>
            <span>started {when(s.startedAt)}</span>
            <span>
              settings <code>{str(s.settingsVersion)}</code>
            </span>
            {device && <span>{[device.browser, device.os, device.mobile ? "phone" : null].filter(Boolean).join(", ")}</span>}
            <span className="note">{sid}</span>
          </p>
        </div>
      </div>

      <section className="adm-kpis">
        <div><b>{str(s.reachedStep)}</b><span>reached</span></div>
        <div><b>{mmss(s.minTotal)}</b><span>in total (min:s)</span></div>
        <div><b>{str(s.turns)}</b><span>messages to Kai</span></div>
        <div><b>{str(s.factsCorrect)}/{str(s.factsTotal)}</b><span>facts explained{s.readyReason ? `, ended: ${str(s.readyReason)}` : ""}</span></div>
        <div><b>{s.testScore === null || s.testScore === undefined ? "–" : `${str(s.testScore)}/${str(s.testOf)}`}</b><span>final test</span></div>
        <div><b>{s.pretestScore === null || s.pretestScore === undefined ? "–" : `${str(s.pretestScore)}/${str(s.pretestOf)}`}</b><span>pretest{s.excluded ? ", excluded" : ""}</span></div>
      </section>

      <div className="adm-two">
        <div className="adm-stack">
          <section className="adm-card">
            <h2>Time per step</h2>
            <ol className="ch-funnel">
              {steps.map(([name, m]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span className="ch-pair">
                    <i className={rec ? "ch-r" : "ch-d"} style={{ width: `${typeof m === "number" ? (m / longest) * 100 : 0}%` }} />
                  </span>
                  <b>{mmss(m)}</b>
                </li>
              ))}
            </ol>
            <p className="note" style={{ marginTop: 10 }}>
              Video watched {s.watchedSec === null || s.watchedSec === undefined ? "–" : `${Math.round(Number(s.watchedSec))} of ${str(s.lessonSec)} s`}; {str(s.tabHidden)} tab switches, {str(s.tabAwaySec)} s away; {str(s.helpOpens)} help cards opened.
            </p>
          </section>

          <section className="adm-card">
            <h2>Pretest</h2>
            {pre ? (
              <ol className="sd-qs">
                {pack.pretest.map((q) => {
                  const a = (pre.answers as Record<string, number> | undefined)?.[q.id];
                  return (
                    <li key={q.id}>
                      <span className="sd-q">{q.prompt}</span>
                      <span className="sd-a">
                        {a === undefined ? "–" : q.options[a] ?? a}
                        {q.kind === "knowledge" && a !== undefined && <Verdict ok={a === q.answer} />}
                        {q.exclude !== undefined && a === q.exclude && <span className="adm-pill bad">excludes</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="note">Not taken.</p>
            )}
          </section>

          {(survey || feedback.length > 0) && (
            <section className="adm-card">
              <h2>After the test</h2>
              {survey ? (
                survey.skipped ? (
                  <p className="note">The questions were skipped.</p>
                ) : (
                  <dl className="adm-dl">
                    {pack.survey.map((q) => (
                      <div key={q.id} style={{ display: "contents" }}>
                        <dt>{q.prompt}</dt>
                        <dd>{survey[q.id] === undefined ? "–" : q.kind === "scale" ? `${str(survey[q.id])} of 7` : (q.options?.[Number(survey[q.id])] ?? str(survey[q.id]))}</dd>
                      </div>
                    ))}
                  </dl>
                )
              ) : null}
              {feedback.map((f, i) => (
                <p key={i} className="sd-feedback">
                  {f.rating ? <b>{str(f.rating)}/5 </b> : null}
                  {str(f.text || "(rating only)")}
                </p>
              ))}
            </section>
          )}
        </div>

        <div className="adm-stack">
          <section className="adm-card">
            <h2>{s.phase === "delayed" ? "Follow-up test" : "Final test"}</h2>
            {grade ? (
              <ol className="sd-qs">
                {testRows.map(({ x, q }) => (
                  <li key={x.id}>
                    <span className="sd-q">
                      <code>{x.id}</code> {q?.prompt ?? ""}
                    </span>
                    <span className="sd-a">
                      {x.chosen === null ? <span className="note">no answer</span> : q?.kind === "choice" ? <Option i={Number(x.chosen)} text={q.options?.[Number(x.chosen)]} /> : `${String(x.chosen)}${q?.unit ? ` ${q.unit}` : ""}`}
                      <Verdict ok={x.correct} />
                    </span>
                    {!x.correct && q && <span className="sd-key">key: {q.kind === "choice" ? <Option i={q.answer} text={q.options?.[q.answer]} /> : keyText(q)}</span>}
                    {x.work && <span className="sd-work">working: {x.work}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="note">Not taken.</p>
            )}
          </section>
        </div>
      </div>

      <section className="adm-card">
        <h2>Teaching Kai</h2>
        <ol className="adm-chat">
          {chat.map((c, i) => {
            const judged = (c.judged as { fact: string; verdict: string; quote: string; note?: string | null }[]) ?? [];
            const mis = (c.misconceptions as { quote: string; belief?: string }[]) ?? [];
            return (
              <li key={i}>
                <div className="adm-you">
                  <span className="note">{off(c)}</span> {str(c.message)}
                </div>
                <div className="sd-verdicts">
                  <span className="note">{str(c.intent)}</span>
                  {judged.map((v, j) => (
                    <span key={j} className={`adm-pill ${v.verdict === "correct" ? "ok" : v.verdict === "wrong" ? "bad" : "part"}`} title={v.note ?? v.quote}>
                      {factLabel(v.fact)}: {v.verdict}
                    </span>
                  ))}
                  {mis.map((m, j) => (
                    <span key={`m${j}`} className="adm-pill bad" title={m.quote}>
                      believes: {m.belief ?? m.quote}
                    </span>
                  ))}
                  <span className="note">
                    move {str((c.move as { type: string })?.type)}, mood {str(c.mood)}
                    {((c.leaked as unknown[]) ?? []).length ? ", a blocked word rewritten" : ""}
                  </span>
                </div>
                <div className="adm-kai">Kai: {str(c.reply)}</div>
              </li>
            );
          })}
          {!chat.length && <li className="note">No messages.</li>}
        </ol>
      </section>

      <section className="adm-card">
        <h2>Practice</h2>
        {problems.map(({ p, checks, kai, skipped }) => (
          <div key={p.id} className="sd-problem">
            <h3>
              <code>{p.id}</code> {p.title} <span className="note">round {p.round}</span>
              {skipped && <span className="adm-pill">skipped</span>}
            </h3>
            {checks.map((c, i) => (
              <p key={i}>
                Try {str(c.attempt)}: {p.kind === "choice" ? <Option i={Number(c.answer)} text={p.options?.[Number(c.answer)]} /> : str(c.answer)} <Verdict ok={!!c.correct} />
                {c.work ? <span className="sd-work">working: {str(c.work)}</span> : null}
              </p>
            ))}
            {kai.map((k, i) => {
              const call = calls.find((c) => c.id === p.id && Number(c.attempt) === Number(k.attempt ?? (k.t === "practice_kai_reteach" ? 2 : 1)));
              const gate = k.gate as { missing?: string[]; misled?: string[] } | undefined;
              return (
                <div key={i} className="adm-kaitry">
                  {k.t === "practice_kai_reteach" && <p className="adm-you">Correction: {str(k.message)}</p>}
                  <p>
                    <b>Kai&apos;s {k.t === "practice_kai_reteach" ? "second" : "first"} try</b>: answer {str(k.answer)} <Verdict ok={!!k.correct} />
                    {call && (
                      <>
                        {" "}
                        the learner called it {String(call.call)} <Verdict ok={!!call.agreed}>{call.agreed ? "called it" : "missed"}</Verdict>
                      </>
                    )}
                    <span className="note">
                      {" "}
                      ({str(k.by)}
                      {gate?.missing?.length ? `; the notebook lacked ${gate.missing.map((f) => f.split("|").map(factLabel).join(" or ")).join(", ")}` : ""}
                      {gate?.misled?.length ? `; misled on ${gate.misled.join(", ")}` : ""})
                    </span>
                  </p>
                  <ol>
                    {((k.steps as { text: string; notes: number[] }[]) ?? []).map((st, j) => (
                      <li key={j}>
                        {st.text}
                        {st.notes.length ? <span className="note"> [{st.notes.join(", ")}]</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        ))}
        {!problems.length && <p className="note">No practice.</p>}
      </section>

      <section className="adm-card">
        <details>
          <summary>Every event ({evs.length})</summary>
          <ol className="adm-events">
            {evs.map((e, i) => (
              <li key={i}>
                <span className="note">{off(e)}</span> <b>{e.t}</b> <span className="note">{JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["t", "sid", "at", "v", "seq", "path", "clientAt"].includes(k)))).slice(0, 300)}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </AdminShell>
  );
}
