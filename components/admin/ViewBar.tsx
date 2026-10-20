import Link from "next/link";
import { PERIODS, viewHref, type View } from "@/lib/server/adminview";

const SCOPE_NAME = { participants: "Participants", team: "Team and tests", all: "Everything" } as const;
const PERIOD_NAME = (d: number | null) => (d ? `Last ${d} days` : "All time");

/** The admin pages' filter row: whose sessions, which period, and (with several packs) which topic. */
export default function ViewBar({ path, view, topics, counts, children }: { path: string; view: View; topics?: { slug: string; title: string }[]; counts?: Partial<Record<View["scope"], number>>; children?: React.ReactNode }) {
  return (
    <div className="adm-view" role="group" aria-label="Which sessions to count">
      <span className="adm-seg">
        {(Object.keys(SCOPE_NAME) as View["scope"][]).map((s) => (
          <Link key={s} href={viewHref(path, view, { scope: s })} aria-current={view.scope === s ? "page" : undefined}>
            {SCOPE_NAME[s]}
            {counts?.[s] !== undefined && <i>{counts[s]}</i>}
          </Link>
        ))}
      </span>
      <span className="adm-seg">
        {PERIODS.map((d) => (
          <Link key={String(d)} href={viewHref(path, view, { days: d })} aria-current={view.days === d ? "page" : undefined}>
            {PERIOD_NAME(d)}
          </Link>
        ))}
      </span>
      {topics && topics.length > 1 && (
        <span className="adm-seg">
          <Link href={viewHref(path, view, { topic: null })} aria-current={!view.topic ? "page" : undefined}>
            Every topic
          </Link>
          {topics.map((t) => (
            <Link key={t.slug} href={viewHref(path, view, { topic: t.slug })} aria-current={view.topic === t.slug ? "page" : undefined}>
              {t.title}
            </Link>
          ))}
        </span>
      )}
      {children}
    </div>
  );
}
