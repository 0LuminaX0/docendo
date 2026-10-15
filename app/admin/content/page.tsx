import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { hasTopic, keyText, packFor } from "@/lib/server/content";
import { currentStudy, topicList } from "@/lib/server/study";
import { viewTables } from "@/lib/server/adminview";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: topic content", robots: { index: false, follow: false } };

const pct = (a: number, n: number) => (n ? `${Math.round((a / n) * 100)}%` : "–");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const LETTERS = "ABCDEF";

/**
 * A topic pack as the study uses it, read-only: the lesson's ideas with their facts and Kai's questions, the videos,
 * the practice problems with their keys and the facts they need, both test forms, the pretest and the questions after
 * the test. Beside each item, how participants did with it so far. Admin only (it shows every key); edited in the
 * pack's files.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const { settings } = await currentStudy({ fresh: true });
  const slug = q.topic && hasTopic(q.topic) ? q.topic : settings.topic;
  const pack = packFor(slug);
  const t = await viewTables({ scope: "participants", days: null, topic: slug });
  const topics = topicList();

  // how participants did: facts explained in teaching, practice first tries, test items per form
  const taught = new Map<string, number>();
  const teachers = new Set<string>();
  for (const r of t.turns) {
    teachers.add(String(r.sid));
    for (const f of String(r.newCorrect ?? "").split(" ").filter(Boolean)) taught.set(f, (taught.get(f) ?? 0) + 1);
  }
  const practiceStats = (id: string) => {
    const rows = t.practice.filter((r) => r.id === id);
    const direct = rows.filter((r) => r.firstTryCorrect !== null);
    const rec = rows.filter((r) => r.kaiFirstTry !== null);
    return { direct: direct.length, directFirst: direct.filter((r) => r.firstTryCorrect === true).length, rec: rec.length, kaiFirst: rec.filter((r) => r.kaiFirstTry === true).length };
  };
  const testStats = (id: string, version: string) => {
    const rows = t.test.filter((r) => r.id === id && r.phase !== "delayed" && String(r.version) === version);
    return { n: rows.length, right: rows.filter((r) => r.correct === true).length };
  };
  const lessonNodes = pack.bundle.nodes.filter((n) => n.inLesson !== false);
  const around = pack.bundle.nodes.filter((n) => n.inLesson === false);
  const parts = settings.topic === slug && settings.watch.on ? settings.watch.parts : [];

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>{pack.title}</h1>
          <p className="note">
            The topic pack in <code>topics/{pack.slug}/</code>, read-only: edit its files, then <code>pnpm content validate {pack.slug}</code> and <code>pnpm content bundle {pack.slug}</code>.
            {settings.topic === slug ? " The study runs this pack." : " Not the pack the study runs now."} Numbers beside the items: participants so far.
          </p>
          {topics.length > 1 && (
            <p className="adm-filters">
              {topics.map((x) => (
                <Link key={x.slug} className="adm-filter" href={`/admin/content?topic=${x.slug}`} aria-current={x.slug === slug ? "page" : undefined}>
                  {x.title}
                </Link>
              ))}
            </p>
          )}
        </div>
      </div>

      <nav className="adm-toc" aria-label="On this page">
        <a href="#ideas">Ideas and facts ({lessonNodes.length})</a>
        <a href="#videos">Videos ({pack.bundle.videos.length})</a>
        {pack.pretest.length > 0 && <a href="#pretest">Pretest ({pack.pretest.length})</a>}
        <a href="#practice">Practice ({pack.practice.length})</a>
        {pack.forms.map((f) => (
          <a key={f} href={`#form-${f}`}>
            Test form {f} ({pack.formItems(f).length})
          </a>
        ))}
        {pack.survey.length > 0 && <a href="#survey">After the test ({pack.survey.length})</a>}
      </nav>

      <section className="adm-card" id="ideas">
        <h2>Ideas and facts</h2>
        <p className="note">
          Goal: {pack.bundle.goals[0]?.text}. Kai waits for the required facts; each has the beginner&apos;s question Kai asks for it. &quot;Explained&quot;: share of the {teachers.size} participants who taught Kai so far who explained the fact correctly.
        </p>
        <ol className="cnt-ideas">
          {lessonNodes.map((n) => (
            <li key={n.id} id={n.id}>
              <div className="cnt-idea-head">
                <h3>{n.label}</h3>
                <code>{n.id}</code>
                {n.needs.length > 0 && <span className="note">after {n.needs.map((x) => pack.bundle.nodes.find((m) => m.id === x)?.label ?? x).join(", ")}</span>}
              </div>
              <table className="adm-table cnt-facts">
                <tbody>
                  {n.facts.map((f) => (
                    <tr key={f.id} className={f.required && f.teachable ? "" : "off"}>
                      <td className="cnt-fact">
                        {f.text}
                        {f.ask && <span className="cnt-ask">Kai asks: {f.ask}</span>}
                      </td>
                      <td className="note">{f.required ? (f.teachable ? "waits for it" : "not in the videos") : "optional"}</td>
                      <td className="num">{f.required && f.teachable ? pct(taught.get(f.id) ?? 0, teachers.size) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {n.misconception && <p className="cnt-mis">Kai may guess: &quot;{n.misconception.says}&quot;</p>}
            </li>
          ))}
        </ol>
        {around.length > 0 && <p className="note">Around the lesson (in Kai&apos;s mind, never asked about or counted): {around.map((n) => n.label).join(", ")}.</p>}
      </section>

      <section className="adm-card" id="videos">
        <h2>Videos</h2>
        <ul className="cnt-videos">
          {pack.bundle.videos.map((v) => (
            <li key={v.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" width={112} height={63} />
              <div>
                <b>{v.title}</b>
                <span className="note">
                  <code>{v.videoId}</code>
                  {v.durationSec ? `, ${mmss(v.durationSec)}` : ""}; in the lesson now: {parts.filter((p) => p.videoId === v.videoId).map((p) => `${mmss(p.start)} to ${mmss(p.end)}`).join(", ") || "no part"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {pack.pretest.length > 0 && (
        <section className="adm-card" id="pretest">
          <h2>Before you start</h2>
          <ol className="cnt-items">
            {pack.pretest.map((p) => (
              <li key={p.id} id={p.id}>
                <p>
                  <code>{p.id}</code> <span className="adm-pill">{p.kind}</span> {p.prompt}
                </p>
                <ol className="cnt-opts">
                  {p.options.map((o, i) => (
                    <li key={i} className={p.answer === i ? "key" : p.exclude === i ? "excl" : ""}>
                      <span>{LETTERS[i]}</span> {o}
                      {p.exclude === i && <em> excludes the session</em>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="adm-card" id="practice">
        <h2>Practice problems</h2>
        <p className="note">Kai can only be right when its notebook holds every fact in &quot;needs&quot;; otherwise it reasons from one of the beginner&apos;s wrong rules.</p>
        <ol className="cnt-items">
          {pack.practice.map((p) => {
            const st = practiceStats(p.id);
            return (
              <li key={p.id} id={p.id}>
                <div className="cnt-item-head">
                  <code>{p.id}</code>
                  <span className="adm-pill">round {p.round}</span>
                  {p.idea && <span className="adm-pill">{p.idea}</span>}
                  <b>{p.title}</b>
                  <span className="grow" />
                  <span className="note">
                    first try {pct(st.directFirst, st.direct)} of {st.direct}; Kai first try {pct(st.kaiFirst, st.rec)} of {st.rec}
                  </span>
                </div>
                <p>{p.prompt}</p>
                {p.options ? (
                  <ol className="cnt-opts">
                    {p.options.map((o, i) => (
                      <li key={i} className={p.answer === i ? "key" : ""}>
                        <span>{LETTERS[i]}</span> {o}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="cnt-key">
                    Key: {p.answer}
                    {p.unit ? ` ${p.unit}` : ""}
                    {p.tolerance !== undefined ? ` (± ${p.tolerance})` : ""}
                  </p>
                )}
                <details>
                  <summary>Worked solution, needed facts and Kai&apos;s wrong rules</summary>
                  <ol className="cnt-steps">
                    {p.steps.map((s, i) => (
                      <li key={i}>
                        {s.text} <span className="note">{s.facts.join(", ")}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="note">Needs: {(p.needs ?? [...new Set(p.steps.flatMap((s) => s.facts))]).join(", ")}</p>
                  {p.beliefs?.length ? (
                    <ul className="cnt-beliefs">
                      {p.beliefs.map((b, i) => (
                        <li key={i}>
                          Without {b.replaces}: &quot;{b.belief}&quot;, which leads to {p.options ? `${LETTERS[b.answer]}` : b.answer}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <div className={pack.forms.length > 1 ? "adm-cols" : ""}>
        {pack.forms.map((f) => {
          const v = pack.testVersion(f);
          return (
            <section key={f} className="adm-card" id={`form-${f}`}>
              <h2>Test form {f}</h2>
              <p className="note">
                Version <code>{v}</code>. Share right: participants&apos; final tests on this version.
              </p>
              <ol className="cnt-items">
                {pack.formItems(f).map((x) => {
                  const st = testStats(x.id, v);
                  return (
                    <li key={x.id} id={x.id}>
                      <div className="cnt-item-head">
                        <code>{x.id}</code>
                        <span className="adm-pill">{x.kind === "number" ? "number" : "choice"}</span>
                        {x.pair && <span className="note">twin of {x.pair}</span>}
                        <span className="grow" />
                        <span className="note">
                          {pct(st.right, st.n)} of {st.n}
                        </span>
                      </div>
                      <p>{x.prompt}</p>
                      {x.options ? (
                        <ol className="cnt-opts">
                          {x.options.map((o, i) => (
                            <li key={i} className={x.answer === i ? "key" : ""}>
                              <span>{LETTERS[i]}</span> {o}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="cnt-key">Key: {keyText(x)}{x.tolerance !== undefined ? ` (± ${x.tolerance})` : ""}</p>
                      )}
                      <p className="note">{x.explain}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {pack.survey.length > 0 && (
        <section className="adm-card" id="survey">
          <h2>Questions after the test</h2>
          <ol className="cnt-items">
            {pack.survey.map((s) => (
              <li key={s.id}>
                <p>
                  <code>{s.id}</code> {s.prompt}
                </p>
                <p className="note">{s.kind === "scale" ? `1 (${s.low}) to 7 (${s.high})` : s.options?.join("; ")}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </AdminShell>
  );
}
