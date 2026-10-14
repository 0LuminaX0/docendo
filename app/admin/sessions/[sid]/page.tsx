import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: session", robots: { index: false, follow: false } };

type Ev = Record<string, unknown> & { t: string; at: string };
const str = (v: unknown) => (v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function Page({ params }: { params: Promise<{ sid: string }> }) {
  await requireAdmin();
  const { sid } = await params;
  const t = await loadTables();
  const evs = t.events.filter((e) => e.sid === sid) as Ev[];
  const s = t.sessions.find((x) => x.sid === sid);
  if (!s || !evs.length) notFound();
  const t0 = Date.parse(evs[0]!.at);
  const off = (e: Ev) => {
    const sec = Math.round(((typeof e.clientAt === "number" ? e.clientAt : Date.parse(e.at)) - t0) / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const of = (type: string) => evs.filter((e) => e.t === type);
  const pre = of("pretest")[0];
  const chat = of("chat_turn");
  const kai = evs.filter((e) => e.t === "practice_kai_solve" || e.t === "practice_kai_reteach");
  const checks = of("practice_check");
  const grade = of("grade")[0];
  const feedback = of("client_feedback");

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <p className="note"><Link href="/admin/sessions">Sessions</Link></p>
          <h1>Session {String(s.pid ?? sid.slice(0, 8))}</h1>
          <p className="note">{sid}</p>
        </div>
      </div>
      <section className="adm-kpis">
        <div><b>{str(s.practiceView ?? s.condition)}</b><span>condition ({str(s.entry)})</span></div>
        <div><b>{str(s.reachedStep)}</b><span>reached</span></div>
        <div><b>{str(s.minTotal)} min</b><span>in total</span></div>
        <div><b>{str(s.turns)}</b><span>messages to Kai</span></div>
        <div><b>{str(s.factsCorrect)}/{str(s.factsTotal)}</b><span>facts explained</span></div>
        <div><b>{s.testScore === null ? "–" : `${str(s.testScore)}/${str(s.testOf)}`}</b><span>final test</span></div>
      </section>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>Pretest</h2>
          {pre ? <p>Score {str(pre.score)} of {str(pre.of)}, “I don’t know” {str(pre.dontKnow)}, answers {str(pre.answers)}{pre.excluded ? ". Excluded: took an RL course." : ""}</p> : <p className="note">Not taken.</p>}
          <h2>Timing</h2>
          <p>Pretest {str(s.minPretest)}, watch {str(s.minWatch)}, teach {str(s.minTeach)}, practice {str(s.minPractice)}, test {str(s.minTest)} minutes. Video watched {str(s.watchedSec)} of {str(s.lessonSec)} s.</p>
          <h2>Feedback</h2>
          {feedback.length ? feedback.map((f, i) => <p key={i}>{f.rating ? <b>{str(f.rating)}/5 </b> : null}{str(f.text || "")}</p>) : <p className="note">None.</p>}
        </section>
        <section className="adm-card">
          <h2>Final test</h2>
          {grade ? (
            <table className="adm-table">
              <tbody>
                {((grade.items as { id: string; chosen: number | null; answer: number; correct: boolean }[]) ?? []).map((x) => (
                  <tr key={x.id}><td>{x.id}</td><td>{x.correct ? "right" : "wrong"}</td><td className="note">chose {x.chosen === null ? "nothing" : "ABCD"[x.chosen]}, key {"ABCD"[x.answer]}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="note">Not taken.</p>}
        </section>
      </div>

      <section className="adm-card">
        <h2>Teaching Kai</h2>
        <ol className="adm-chat">
          {chat.map((c, i) => (
            <li key={i}>
              <div className="adm-you"><span className="note">{off(c)}</span> {str(c.message)}</div>
              <div className="adm-meta">
                {str(c.intent)}; {((c.judged as { fact: string; verdict: string }[]) ?? []).map((v) => `${v.fact} ${v.verdict}`).join(", ") || "no facts"}
                {((c.misconceptions as { quote: string }[]) ?? []).length ? `; misconception “${(c.misconceptions as { quote: string }[]).map((m) => m.quote).join("”, “")}”` : ""}
                {"; "}move {str((c.move as { type: string })?.type)}, mood {str(c.mood)}
              </div>
              <div className="adm-kai">Kai: {str(c.reply)}</div>
            </li>
          ))}
          {!chat.length && <li className="note">No messages.</li>}
        </ol>
      </section>

      <section className="adm-card">
        <h2>Practice</h2>
        {kai.map((k, i) => (
          <div key={i} className="adm-kaitry">
            <p><b>{str(k.id)}</b> {k.t === "practice_kai_reteach" ? "Kai's second try" : "Kai's first try"}: <b>{k.correct ? "right" : "wrong"}</b> (answer {str(k.answer)}, {str(k.by)}{k.guess ? `, guessed “${(k.guess as { belief: string }).belief}”` : ""})</p>
            {k.t === "practice_kai_reteach" && <p className="adm-you">Correction: {str(k.message)}</p>}
            <ol>{((k.steps as { text: string; notes: number[] }[]) ?? []).map((st, j) => <li key={j}>{st.text}{st.notes.length ? <span className="note"> [{st.notes.join(", ")}]</span> : null}</li>)}</ol>
          </div>
        ))}
        {checks.map((c, i) => (
          <p key={i}><b>{str(c.id)}</b> try {str(c.attempt)}: {str(c.answer)} {c.correct ? "right" : "wrong"}{c.work ? <span className="note"> working: {str(c.work)}</span> : null}</p>
        ))}
        {!kai.length && !checks.length && <p className="note">No practice.</p>}
      </section>

      <section className="adm-card">
        <details>
          <summary>Every event ({evs.length})</summary>
          <ol className="adm-events">
            {evs.map((e, i) => (
              <li key={i}><span className="note">{off(e)}</span> <b>{e.t}</b> <span className="note">{JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["t", "sid", "at", "v", "seq", "path", "clientAt"].includes(k)))).slice(0, 300)}</span></li>
            ))}
          </ol>
        </details>
      </section>
    </AdminShell>
  );
}
