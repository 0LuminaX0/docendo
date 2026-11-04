/** Text with "ln" set as in print maths (a serif face: in the body font its l reads as an I; a pilot participant
 * stumbled over it). */
export function withLn(text: string): React.ReactNode {
  const parts = text.split(/\b(ln)\b/g);
  return parts.length === 1 ? text : parts.map((t, i) => (i % 2 ? <span key={i} className="ln">ln</span> : t));
}
