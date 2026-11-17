// What Kai's own line before a fixed question may not add (2026-11-17). Kai says back what the learner's latest
// message taught it; the writer, knowing the question it asked ("what happens to each option's bonus as the rounds go
// by, whether it gets picked or not?"), can complete half an answer ("so it grows while it waits, and shrinks once it's
// picked") and so answers the follow-up that comes right after it, or names the rule the learner left out ("so each
// round it takes the highest average"). The term check doesn't see this: "shrinks" and "highest" are ordinary words.
// Each group is one way a rule can go; Kai may use a group only when the learner's message (or Kai's own question, or
// what Kai wrote down from the message) used it too, in any of its words.

const GROUPS: Record<string, RegExp> = {
  grows: /\b(?:grow\w*|grew|rises?|rising|rose|increas\w*|bigger|larger|climb\w*|builds? up|building up|goes up|go up|going up|went up)\b/i,
  shrinks: /\b(?:shrink\w*|shrank|shrunk|falls?|falling|fell|drops?|dropp\w*|decreas\w*|smaller|reduc\w*|sinks?|sinking|sank|declin\w*|goes down|go down|going down|went down)\b/i,
  switches: /\b(?:switch\w*|overtak\w*|overtook|swap\w*|chang\w* (?:its |their |his |her )?(?:mind|favou?rite|pick|choice)|takes? over|took over|goes back to|go back to|comes? back)\b/i,
  sticks: /\b(?:stick\w*|stuck|lock\w*|forever|for good|never (?:again|tries|tried|picks|picked|goes back|comes back)|stays? with)\b/i,
  // the case lock-in starts from (2026-11-17, eval:sim: a learner taught that greedy "never switches" and the averages
  // "even out", and Kai's line added "if the first try gets unlucky and gives a low average, greedy stops trying it",
  // lock-in itself; "stick" was the learner's, so the group above let it through)
  unlucky: /\bunluck\w*|\bbad (?:luck|start|first|day|result|lunch|try)\b|\b(?:stops?|stopped|quits?) (?:trying|picking|choosing|going)\b|\bgives? up on\b|\b(?:drops?|dropped|ignores?|ignored) (?:it|them|that one|the other\w*) (?:for good|forever|after)\b/i,
  pace: /\b(?:slow\w*|faster|fast|quick\w*|steady|steadily|gradual\w*|diminish\w*|taper\w*|log|logs|logarithm\w*|ln)\b/i,
  extreme: /\b(?:highest|lowest|maximum|minimum|max|top)\b/i,
  anew: /\b(?:every|each) (?:single )?(?:round|time|day|step|turn|pick)\b|\bso far\b|\banew\b|\bat (?:that|the) moment\b/i,
  same: /\b(?:stays? (?:the )?same|same as before|unchanged|constant|stays? put)\b/i,
  doubt: /\bbenefit of the doubt\b|\buncertain\w*|\boptimis\w*|\bcould (?:really |actually )?be better\b/i,
};

/** The words in Kai's line that say which way a rule goes where nothing it was given said so, e.g. ["shrinks"]. */
export function addedClaims(line: string, given: string): string[] {
  const out: string[] = [];
  for (const re of Object.values(GROUPS)) {
    const m = re.exec(line);
    if (m && !re.test(given)) out.push(m[0]);
  }
  return out;
}
