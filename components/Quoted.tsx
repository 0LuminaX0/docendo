/**
 * One of Kai's notes: the learner's own words in Kai's normal ink, and the few words Kai added around them to make a
 * whole sentence (from its question, or the rest of the message) in a lighter ink. A note that is just the learner's
 * words shows all in the normal ink, so the rule reads the same everywhere: light means Kai's, normal means yours.
 */
export default function Quoted({ text, quote }: { text: string; quote?: string | null }) {
  const at = quote && quote !== text ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (at < 0) return <span className="said">{text}</span>;
  const before = text.slice(0, at);
  const after = text.slice(at + quote!.length);
  return (
    <>
      {before && <span className="added">{before}</span>}
      <span className="said">{text.slice(at, at + quote!.length)}</span>
      {after && <span className="added">{after}</span>}
    </>
  );
}
