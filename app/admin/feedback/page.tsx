import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { viewHref, viewOf, viewTables } from "@/lib/server/adminview";
import { packFor } from "@/lib/server/content";
import { currentStudy, topicList } from "@/lib/server/study";
import { answerText, practisedOf, surveyQuestions, type SurveyQuestion } from "@/lib/server/survey";
import { inScope, mean } from "@/lib/analytics";
import AdminShell from "@/components/admin/AdminShell";
import ViewBar from "@/components/admin/ViewBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: feedback", robots: { index: false, follow: false } };

type Cond = "direct" | "recursive";
type Row = Record<string, unknown>;
const CONDS: Cond[] = ["direct", "recursive"];
const pill = (c: string) => <span className={`adm-pill ${c === "recursive" ? "rec" : "dir"}`}>{c}</span>;
const day = (iso: unknown) => (typeof iso === "string" ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "");
const pct = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : "");
const SHOWN = 8; // open answers shown per question before "Show more"

/** The answers to one open question, each with whose it is and a link to the session. */
function Quotes({ rows, q }: { rows: Row[]; q?: SurveyQuestion }) {
  return (
    <ul className="adm-quotes">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="sv-text-plain">{answerText(q, r.answer)}</span>
          <span className="sv-meta">
            {pill(practisedOf(r))}{" "}
            <span className="note">
              {String(r.entry ?? "")}
              {r.testScore !== null && r.testScore !== undefined ? `, test ${String(r.testScore)}/${String(r.testOf ?? "?")}` : ""}, {day(r.at)}
            </span>{" "}
            <Link className="note" href={`/admin/sessions/${String(r.sid)}`}>
              session
            </Link>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything learners said after the final test, in the view's sessions: how many answered, skipped or left first;
 * each rating per condition with its spread; each choice per condition; every open answer by question, newest first,
 * with its session; and the feedback box (the results page's, where no questions were asked). The session's own page
 * shows one person's answers together.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await searchParams;
  const view = viewOf(q);
  const t = await viewTables(view);
  const cond: Cond | null = q.cond === "direct" || q.cond === "recursive" ? q.cond : null;
  const conds = cond ? [cond] : CONDS;
  const pack = view.topic ? packFor(view.topic) : (await currentStudy()).pack;
  const questions = surveyQuestions(pack);
  const inCond = (r: Row) => !cond || practisedOf(r) === cond;

  const answers = t.survey.filter(inCond);
  const sessions = t.sessions.filter(inCond);
  const of = (id: string, c?: Cond) => answers.filter((r) => r.question === id && (!c || practisedOf(r) === c));
  const answeredSids = new Set(answers.map((r) => String(r.sid)));
  const answeredBy = (c: Cond) => new Set(answers.filter((r) => practisedOf(r) === c).map((r) => String(r.sid))).size;
  const skipped = sessions.filter((s) => s.surveySkipped === true);
  // finished the final test (not the follow-up) with the questions on, but sent nothing: left on them. Sessions from
  // before 17 November didn't log whether the questions were on, so those may also have had them switched off.
  const none = sessions.filter((s) => s.phase !== "delayed" && s.testScore !== null && s.testScore !== undefined && s.surveySkipped === null && s.surveyOn !== false && !answeredSids.has(String(s.sid)));
  const unsure = none.filter((s) => s.surveyOn === null).length;
  const known = new Set(questions.map((x) => x.id));
  const asked = (x: SurveyQuestion) => of(x.id).length > 0 || (!x.until && (!x.condition || conds.includes(x.condition)));
  const scales = questions.filter((x) => x.kind === "scale" && asked(x));
  const choices = questions.filter((x) => x.kind === "choice" && asked(x));
  // open questions, and any answer whose question this pack doesn't know (another pack's, or one taken out unrecorded)
  const open: SurveyQuestion[] = [...questions.filter((x) => x.kind === "text" && asked(x)), ...[...new Set(answers.map((r) => String(r.question)).filter((id) => !known.has(id)))].map((id) => ({ id, kind: "text" as const, prompt: id }))];
  const written = answers.filter((r) => open.some((x) => x.id === r.question)).length;

  // the feedback box: since 16 November the survey's last answer (and until 17 November its rating) is logged there too,
  // so keep only what the questions don't already hold
  const said = (sid: unknown, id: string) => answers.find((r) => r.sid === sid && r.question === id)?.answer;
  const box = t.feedback.filter(inCond).filter((f) => !answeredSids.has(String(f.sid)) || String(f.text ?? "").trim() !== String(said(f.sid, "anything") ?? "").trim() || (f.rating !== null && f.rating !== undefined && f.rating !== said(f.sid, "rating"))).reverse();
  const boxRatings = (c: Cond) => box.filter((f) => typeof f.rating === "number" && practisedOf(f) === c).map((f) => Number(f.rating));

  const counts = { participants: t.allSessions.filter((x) => inScope(x, "participants")).length, team: t.allSessions.filter((x) => inScope(x, "team")).length, all: t.allSessions.length };
  const elsewhere = view.scope === "participants" ? counts.team : 0;
  const link = (p: Record<string, string | undefined>) => viewHref("/admin/feedback", view, {}, { cond: cond ?? undefined, ...p });
  const nothing = !answers.length && !box.length && !skipped.length;

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Feedback</h1>
          <p className="note">The questions after the final test, asked before the score, and the feedback box. One person&apos;s answers are together on their session&apos;s page.</p>
        </div>
        <div className="adm-actions">
          <span className="note">Export</span>
          <a className="btn ghost small" href="/api/admin/export?table=survey">survey.csv</a>
          <a className="btn ghost small" href="/api/admin/export?table=feedback">feedback.csv</a>
        </div>
      </div>
      <ViewBar path="/admin/feedback" view={view} topics={topicList()} counts={counts}>
        <span className="adm-seg">
          {(["", "direct", "recursive"] as const).map((c) => (
            <Link key={c} href={link({ cond: c || undefined })} aria-current={(cond ?? "") === c ? "page" : undefined}>
              {c || "Both conditions"}
            </Link>
          ))}
        </span>
      </ViewBar>

      {nothing ? (
        <section className="adm-card">
          <p className="note">
            No answers in this view yet.
            {elsewhere > 0 && (
              <>
                {" "}
                <Link href={viewHref("/admin/feedback", view, { scope: "team" })}>See Team and tests</Link>.
              </>
            )}
          </p>
        </section>
      ) : (
        <>
          <section className="adm-kpis">
            <div>
              <b>{answeredSids.size}</b>
              <span>answered{cond ? "" : ` (direct ${answeredBy("direct")}, recursive ${answeredBy("recursive")})`}</span>
            </div>
            <div>
              <b>{skipped.length}</b>
              <span>skipped the questions</span>
            </div>
            <div className={none.length - unsure ? "warn" : undefined}>
              <b>{none.length}</b>
              <span>finished the test, sent no answers{unsure ? ` (${unsure} from before 17 November, maybe with the questions off)` : ""}</span>
            </div>
            <div>
              <b>{written}</b>
              <span>open answers written</span>
            </div>
          </section>

          {scales.length > 0 && (
            <section className="adm-card">
              <h2>Ratings</h2>
              <p className="note">Mean, how many answered, and the spread from the lowest point to the highest; direct blue, recursive violet.</p>
              <table className="adm-table sv-ratings">
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    {conds.map((c) => (
                      <th key={c} scope="col">{c}</th>
                    ))}
                    {conds.length === 2 && <th scope="col">recursive − direct</th>}
                  </tr>
                </thead>
                <tbody>
                  {scales.map((x) => {
                    const points = x.points ?? 7;
                    const vals = (c: Cond) => of(x.id, c).map((r) => Number(r.answer)).filter((v) => Number.isFinite(v));
                    const m = (c: Cond) => mean(vals(c));
                    const d = m("direct");
                    const r = m("recursive");
                    return (
                      <tr key={x.id}>
                        <td className="wrap">
                          <span className="sv-q">{x.prompt}</span>
                          <span className="sv-tag">
                            {" "}
                            1: {x.low}, {points}: {x.high}
                            {x.until ? `; asked until ${x.until}` : ""}
                            {x.condition ? `; ${x.condition} only` : ""}
                          </span>
                        </td>
                        {conds.map((c) => {
                          const v = vals(c);
                          const hist = Array.from({ length: points }, (_, i) => v.filter((k) => k === i + 1).length);
                          const top = Math.max(1, ...hist);
                          return (
                            <td key={c}>
                              <span className="sv-cell">
                                <b>{m(c) ?? "–"}</b>
                                <span className="note">n {v.length}</span>
                                <span className={`sv-hist ${c === "recursive" ? "rec" : "dir"}`} aria-label={hist.map((k, i) => `${i + 1}: ${k}`).join(", ")}>
                                  {hist.map((k, i) => (
                                    <i key={i} title={`${i + 1}: ${k}`} style={{ height: `${Math.max(k ? 12 : 0, (k / top) * 100)}%` }} />
                                  ))}
                                </span>
                              </span>
                            </td>
                          );
                        })}
                        {conds.length === 2 && <td>{d !== null && r !== null ? `${r - d > 0 ? "+" : r - d < 0 ? "−" : ""}${Math.abs(Math.round((r - d) * 10) / 10)}` : "–"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {choices.length > 0 && (
            <section className="adm-card">
              <h2>Choices</h2>
              <div className="sv-choices">
                {choices.map((x) => {
                  const n = (c: Cond) => of(x.id, c).length;
                  // a question asked in one practice only: that condition's column (a team session that switched views
                  // may still have answered it in the other)
                  const cols = conds.filter((c) => !x.condition || c === x.condition || n(c) > 0);
                  return (
                    <div key={x.id}>
                      <p className="sv-q">
                        {x.prompt}
                        {(x.until || x.condition) && <span className="sv-tag"> {[x.condition ? `${x.condition} only` : null, x.until ? `asked until ${x.until}` : null].filter(Boolean).join("; ")}</span>}
                      </p>
                      <table className="adm-table sv-choice">
                        <thead>
                          <tr>
                            <th scope="col">Answer</th>
                            {cols.map((c) => (
                              <th key={c} scope="col">{c} ({n(c)})</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(x.options ?? []).map((o, i) => (
                            <tr key={i}>
                              <td className="wrap">{o}</td>
                              {cols.map((c) => {
                                const k = of(x.id, c).filter((r) => Number(r.answer) === i).length;
                                return (
                                  <td key={c}>
                                    {k} <span className="note">{pct(k, n(c))}</span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {open.length > 0 && (
            <section className="adm-card">
              <h2>In their own words</h2>
              <nav className="sv-index" aria-label="Open questions">
                {open.map((x) => (
                  <a key={x.id} href={`#q-${x.id}`}>
                    {x.prompt} <i>{of(x.id).length}</i>
                  </a>
                ))}
              </nav>
              {open.map((x) => {
                const rows = [...of(x.id)].sort((a, b) => String(b.at).localeCompare(String(a.at)));
                return (
                  <div key={x.id} id={`q-${x.id}`} className="sv-group">
                    <h3 className="adm-sub">
                      {known.has(x.id) ? x.prompt : <code>{x.id}</code>} <span className="note">{rows.length}</span>
                    </h3>
                    {(x.hint || x.condition || x.until) && <p className="note">{[x.hint, x.condition ? `Asked in ${x.condition} practice only.` : null, x.until ? `Asked until ${x.until}.` : null].filter(Boolean).join(" ")}</p>}
                    {rows.length ? (
                      <>
                        <Quotes rows={rows.slice(0, SHOWN)} q={known.has(x.id) ? x : undefined} />
                        {rows.length > SHOWN && (
                          <details className="sv-more">
                            <summary>Show {rows.length - SHOWN} more</summary>
                            <Quotes rows={rows.slice(SHOWN)} q={known.has(x.id) ? x : undefined} />
                          </details>
                        )}
                      </>
                    ) : (
                      <p className="note">No answers yet.</p>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {box.length > 0 && (
            <section className="adm-card">
              <h2>Feedback box</h2>
              <p className="note">
                The results page&apos;s own box: since 16 November only where no questions were asked (the follow-up test, or the questions switched off); before that, after them.
                {CONDS.some((c) => boxRatings(c).length) && ` Mean rating of 5: ${conds.map((c) => `${c} ${mean(boxRatings(c)) ?? "–"} (${boxRatings(c).length})`).join(", ")}.`}
              </p>
              <ul className="adm-quotes">
                {box.map((f, i) => (
                  <li key={i}>
                    {typeof f.rating === "number" && <b>{f.rating}/5 </b>}
                    <span className="sv-text-plain">{String(f.text || "(rating only)")}</span>
                    <span className="sv-meta">
                      {pill(practisedOf(f))} <span className="note">{String(f.entry ?? "")}{f.testScore !== null && f.testScore !== undefined ? `, test ${String(f.testScore)}/${String(f.testOf ?? "?")}` : ""}, {day(f.at)}</span>{" "}
                      <Link className="note" href={`/admin/sessions/${String(f.sid)}`}>
                        session
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </AdminShell>
  );
}
