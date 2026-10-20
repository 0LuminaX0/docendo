"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

type Kind = "participant" | "trial" | "team";
// short names for the select; what each means is on the page above (Ways in)
const KIND_NAME: Record<Kind, string> = { participant: "Participant", trial: "Trial run", team: "Team" };
const kindOf = (c: { team: boolean; trial?: boolean }): Kind => (c.team ? "team" : c.trial ? "trial" : "participant");

type Code = { id: string; code: string; label: string; condition: "direct" | "recursive" | "random"; draw?: "direct" | "recursive"; team: boolean; trial?: boolean; maxUses: number | null; active: boolean; createdAt: string; uses: number };

async function api(body: unknown) {
  const res = await fetch("/api/admin/codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

/** Make codes in bulk, and switch, relabel or delete them. */
export default function CodeManager({ initial }: { initial: Code[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ count: 10, prefix: "", label: "", condition: "random" as Code["condition"], kind: "participant" as Kind, maxUses: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function run(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const link = (c: Code) => `${location.origin}/?code=${encodeURIComponent(c.code)}`;
  const shown = initial.filter((c) => !filter || `${c.code} ${c.label}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <section className="adm-card">
        <h2>Make codes</h2>
        <form
          className="adm-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "create", count: form.count, prefix: form.prefix, label: form.label, condition: form.condition, team: form.kind === "team", trial: form.kind === "trial", maxUses: form.maxUses === "" ? null : Number(form.maxUses) });
          }}
        >
          <label>How many<input className="input" type="number" min={1} max={200} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></label>
          <label>Prefix<input className="input" placeholder="PILOT" maxLength={10} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} /></label>
          <label>Label<input className="input" placeholder="Pilot, 15 October" maxLength={60} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label>
            Condition
            <select className="input" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as Code["condition"] })}>
              <option value="random">Random (balanced)</option>
              <option value="direct">Direct feedback</option>
              <option value="recursive">Recursive feedback</option>
            </select>
          </label>
          <label>Uses per code<input className="input" type="number" min={1} placeholder="no limit" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} /></label>
          <label>
            Counts as
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              {(Object.keys(KIND_NAME) as Kind[]).map((k) => (
                <option key={k} value={k}>{KIND_NAME[k]}</option>
              ))}
            </select>
          </label>
          <button className="btn primary small" disabled={busy || form.count < 1}>
            <Plus size={14} /> Make {form.count} {form.count === 1 ? "code" : "codes"}
          </button>
        </form>
        <p className="note" style={{ marginTop: 10 }}>
          Participant: the study. Trial run: exactly a participant&apos;s session, counted with the tests (to try the study yourself). Team: the test shortcuts and the &quot;You solve / Kai solves&quot; switch.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="adm-card">
        <div className="adm-head" style={{ marginBottom: 8 }}>
          <h2>{initial.length} {initial.length === 1 ? "code" : "codes"}</h2>
          <input className="input adm-search" placeholder="Find a code or label" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <table className="adm-table">
          <thead>
            <tr><th>Code</th><th>Label</th><th>Counts as</th><th>Condition</th><th>Used</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={c.active ? "" : "off"}>
                <td><code>{c.code}</code></td>
                <td>{c.label || <span className="note">–</span>}</td>
                <td>
                  <select className="input adm-inline" value={kindOf(c)} disabled={busy} onChange={(e) => void run({ action: "update", code: c.code, team: e.target.value === "team", trial: e.target.value === "trial" })}>
                    <option value="participant">participant</option>
                    <option value="trial">trial run</option>
                    <option value="team">team</option>
                  </select>
                </td>
                <td>
                  <select className="input adm-inline" value={c.condition} disabled={busy} onChange={(e) => void run({ action: "update", code: c.code, condition: e.target.value })}>
                    <option value="random">random</option>
                    <option value="direct">direct</option>
                    <option value="recursive">recursive</option>
                  </select>
                </td>
                <td>
                  {c.uses ? (
                    <Link href={`/admin/sessions?scope=all&q=${encodeURIComponent(c.id)}`} title="This code's sessions">
                      {c.uses}
                    </Link>
                  ) : (
                    c.uses
                  )}
                  {c.maxUses ? ` of ${c.maxUses}` : ""}
                  {c.condition === "random" && c.draw && <span className="note"> (first: {c.draw})</span>}
                </td>
                <td>
                  <button type="button" className="linkish" disabled={busy} onClick={() => void run({ action: "update", code: c.code, active: !c.active })}>
                    {c.active ? "active" : "off"}
                  </button>
                </td>
                <td className="adm-rowact">
                  <button type="button" className="iconbtn" title="Copy the study link" onClick={() => void navigator.clipboard.writeText(link(c)).then(() => setCopied(c.id))}>
                    <Copy size={14} />
                  </button>
                  {copied === c.id && <span className="note">copied</span>}
                  <button type="button" className="iconbtn" title="Delete" disabled={busy} onClick={() => confirm(`Delete ${c.code}? Sessions already started keep their data.`) && void run({ action: "delete", code: c.code })}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} className="note">No codes yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
