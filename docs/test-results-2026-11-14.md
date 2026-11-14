# Test results, 2026-11-14: the handoff's live checks of teaching and solving Kai

The runs asked for in [handoff-2026-11-13.md](handoff-2026-11-13.md), all against the live models through OpenRouter (judge and reaction writer `google/gemini-3.5-flash-lite`, solver `anthropic/claude-haiku-5.5`, simulated learners `anthropic/claude-haiku-5.5`), on commit `18e22f9`. Nothing in the code or content was changed: this is a report, with what to fix below.

## In short

| Check (handoff step) | Result | Verdict |
|---|---|---|
| 1. Judge, `eval:judge --reps 3` | false credit 0; facts 59/66, intent 15/15, misconceptions 22/24 | **2 problems**: a clear lock-in goes to the wrong fact, and the lucky-leader remark is still a misconception |
| 2. Teaching end to end, `eval:sim --reps 2 --solve --show` | recall 83/86, false credit 2, vague as full 0, wrong beliefs 5/6, repeats 7 in 16, gate 44/48, Kai wrong at least once in 16/16, right when the gate was open 27/27 | **mostly as intended**; the gate misses trace back to the two judge problems |
| 3. Corrections from scratch, `eval:sim --empty --reps 1` | Kai wrong at least once in 8/8; 2 right first try + 9 after one correction, of 19 | as expected for one correction; p3 (four facts) never fixed in one go |
| 4. Solver, `eval:solver --items p7,p3,p2 --reps 10 --audit` | full notebook 10/10 on each; every missing fact 10/10 on its wrong answer; 230/230 as predicted | **passes**; the audit's "uses a fact it wasn't told" (97/178) is the audit misreading Kai's guesses |
| 5. By hand (scripted, live): terse and thorough | terse: as intended; thorough: **lock-in partial, misconception on n05, p3's gate shut** | **fails** for the thorough teacher |

**The one thing to fix before Monday:** a learner who explains lock-in fully, with an example, gets n06.f1 only as *partial*, so problem p3's gate stays shut and Kai fails a learner who taught it well. It happened in the thorough by-hand conversation (both runs), in the simulated solid learner, and in judge case #6 (3 of 3). Details and two ways to fix it under [Problem 1](#problem-1-a-full-lock-in-explanation-is-only-partial).

## Problem 1: a full lock-in explanation is only partial

**What happens.** n06.f1 (lock-in) and n06.f2 (its worked example: "if truck A is truly the best but its first lunch is poor, greedy eats at the other trucks from then on and never finds out") are both required facts in the graph, and n06.f2 is made optional in the lesson. When a learner explains lock-in *with* an example, the judge files the example sentence (which carries "never picks it again", "never corrects") under **n06.f2**, and credits n06.f1 with a general sentence that has no key words, such as "Greedy can lock in if the first tries are very unlucky." The evidence check then looks only at that sentence (and the key quote's), finds no "never … again / corrected", and turns n06.f1 into partial. p3 needs n06.f1, so its gate stays shut.

**Seen in:**
- Judge case #6, "If the best truck has one bad lunch at the start, greedy might never go back to it, so it never finds out it's actually the best.": in a separate probe (3 runs) the judge gave **n06.f2 correct and no n06.f1** in 2 of 3; the eval reports "only partial for n06.f1" 3/3.
- The thorough by-hand conversation (P_TestAfterFixes1's messages), both runs: `n06.f1:partial n06.f2:correct`, dropped "Greedy can lock in if the first tries are very unlucky (correct → partial: no evidence of the key)". The key words are two sentences later: "Then greedy just keeps pulling this other arm and never corrects this misconception about the best arm."
- Simulated solid learner (run 1): "…Greedy then sees the good option's average as too low, never picks it again, and never finds out how good it really is." → `n06.f1:partial n06.f2:correct`, gate shut on p3.
- Corrections from scratch (terse learner, p3): the correction was credited as `n06.f2:correct`, not n06.f1, so the retry stayed wrong.

**Not a problem:** the terse answers ("Greedy can lock in on the wrong arm with an unlucky start", "It can get stuck if the best option had an unlucky first result") are partial, as the handoff wants. The eval's knowledge sheet counts the terse learner as knowing lock-in, so it books those two p3 shuts as gate misses; they are the intended stricter credit.

**Ways to fix it** (either keeps the AI judging and the code checking around it):
1. *Evidence over the learner's whole answer for this fact.* Each message answers one of Kai's questions, so checking n06.f1's evidence across the message (or the credited sentence and the two after it) catches the example's "never … again" while the terse answers, which have no such words anywhere, stay partial. Add the three messages above to `tests/judge.test.ts`.
2. *Let a correct n06.f2 carry n06.f1's key.* The example is lock-in with numbers: if n06.f2 is correct in the same message and its sentence has n06.f1's evidence, credit n06.f1 as correct too. Or tell the judge in the prompt that an example of lock-in that says the option is never tried again is n06.f1 (and n06.f2).

Option 1 is the smaller change. Either way, rerun `pnpm eval:judge --reps 3` and the thorough conversation.

## Problem 2: the lucky-leader remark is still recorded as a misconception

8502ddf names the remark in the judge prompt ("a leader that only got lucky keeps being picked, its average corrects itself and greedy switches" is true, not a misconception). It still gets recorded:
- Judge case #21: misconception in 2 of 3 runs (on node **n05**, belief "Greedy keeps pulling a wrong favourite long enough for its average to converge and then switches…"). Probe: 2 of 3 again.
- Thorough by-hand conversation: run 1 on n06, run 2 on **n05** ("…the estimated mean of the arm that is being pulled will slowly change and converge to its true mean. Greedy will eventually switch arms…"). The handoff asks for no misconception on n05.f1 here.

In these runs it didn't close p7 (the note has no fact pinned), but Kai believes it and its notebook shows it, and an n05 misconception is exactly what closed P7's gate in the pilot. Kai's reaction even said it back: "Ah, the estimated mean will slowly change and converge to its true mean, and greedy will eventually switch arms."

**Fix:** the prompt alone doesn't hold. A code check in the same spirit as the evidence patterns: a misconception on n05/n06 whose quote says the *pulled/picked/favoured* option's average converges or corrects (rather than an option that isn't picked) is dropped and logged. Add case #21 and the thorough message to `tests/judge.test.ts`.

## Problem 3 (smaller): a wrong "never switches" is pinned to lock-in, not to greedy's rule

The simulated misled learner says "once it settles on one, it sticks with that one forever and never switches". That's a wrong belief about n05.f1 (greedy switches when overtaken). The judge recorded it under **n06** both times, and a later "it just goes with the highest average" credited n05.f1 as correct. With no misconception on n05, p7's gate opened in one of the two runs (`open:p7`, the eval's 2 "false credit" are this). n05.f1 has no key, so "picks the highest average" alone counts as correct by design; the problem is only where the wrong belief lands. A line in the judge prompt ("never switches / sticks forever is about greedy's rule, n05") or a misconception hint on n05 should do it. Lower priority than 1 and 2: a learner who teaches "never switches" is rare and Kai's p7 answer then matches what it was told.

## 1. The judge (`pnpm eval:judge --reps 3`)

35 cases (28 run, 7 about ideas outside the lesson kept but not run), 3 repetitions.

```
facts found 59/66, false credit 0, intent 15/15, misconceptions 22/24, errors 0
median 2433 ms, slowest 3165 ms
notes with Kai's words added 8/118
```

| Case | Wanted | Got (of 3) | Cause |
|---|---|---|---|
| #6 clear lock-in with an example | n06.f1 correct | partial 3/3 | Problem 1 |
| #18 the pilot's "…prevent the Greedy rule from choosing this option again. To solve this, there is the UCB rule" | n06.f1 correct | partial 1/3 | Problem 1 (probe: correct 3/3) |
| #11 c sets the bonus's size | n11.f2 correct | partial 2/3 | c left the lesson and n11.f2 is optional: no effect |
| #21 lucky leader | no misconception | misconception 2/3 | Problem 2 |
| #22 "it prioritizes arms that have been explored less" | n11.f4 partial | nothing 3/3 | the judge gives no verdict instead of partial; no gate needs n11.f4, so harmless |
| #25 "for exploring bad options… get a higher bonus" | n11.f4 partial | nothing 1/3 (eval), partial 3/3 (probe, through the evidence check) | as #22 |

- **False credit stays 0**, and the new terse cases pass: #23 "lock in … with an unlucky start" partial, #24 "a mean and a bonus" partial, #26 the benefit of the doubt correct, #27 "grows logarith-" correct.
- **Is a check too strict?** The "correct → partial" drops on cases that want correct are all n06.f1 (Problem 1). The n11.f1, n11.f4 and n12.f2 patterns turned correct into partial only where the case wants partial.

## 2. Teaching end to end (`pnpm eval:sim --reps 2 --solve --show`)

8 simulated learners × 2, learner model Claude Haiku 5.5. Data: `data/eval-sim-2026-11-14T00-28-41.json`. $0.40.

```
TOTAL recall 83/86 (97%), false credit 2, vague→correct 0, wrong caught 5/6, repeats 7, confusing 0,
messages 122, words 7165, gate 44/48, understood 91% on average, Kai wrong at least once in 16/16 sessions,
Kai solved 27 first try + 12 after a fix (should 38), right when the gate was open 27/27
```

Against 2026-11-05 (recall 98/98, false credit 0, vague as full 0, wrong beliefs 15/16, repeats 6 and 7 in 16, gate 96/96; with the old questions and facts, so not one to one):

| What matters | 2026-11-14 | Reading |
|---|---|---|
| Credit matches what was said | recall 83/86: solid 5/6 once, terse 6/7 twice | the three misses are n06.f1 partial: twice terse (intended), once solid (Problem 1) |
| False credit and vague as full stay 0 | false credit 2, vague as full 0 | both "false credits" are the misled learner's n05.f1 (Problem 3) |
| Wrong beliefs caught | 5/6 | misled run 1 caught 2 of 3 |
| Few repeats | 7 in 16 conversations | as on 11-05 |
| Gate opens exactly where knowledge suffices | 44/48 | p3 shut for terse ×2 (intended), solid ×1 (Problem 1); p7 open for misled ×1 (Problem 3) |
| Kai wrong at least once in most sessions | 16/16; no "NEVER WRONG" | |
| One correction sets it right | every first-try miss in a learner who knew enough was fixed by one correction (12) | |
| Right only when the gate is open | 27/27 | |

**P7's caveat** came up in 10 of the 16 sessions (every learner whose notebook met all of p7's needs): Kai misread (answer C, "A's 7.5 will come down the way B's lucky 9 did"), and one correction fixed it every time, even a correction the judge credited no fact for (chatty: "A's 7.5 is actually below its true average of 8, so once greedy picks A again its average should climb toward 8"). The sim prints Kai's answer and its cause, not its steps, so "a misreading never goes against a note" isn't visible here; step 4's audit covers it per problem.

**Reactions** (read in the terse, partial, realistic and chatty conversations): each says back the latest message only, a few words of it, without older notes, e.g. "Hm, the best option had an unlucky first result, so it gets stuck." The one exception is a true statement said back from the latest message that is a misconception elsewhere (Problem 2).

## 3. Corrections from scratch (`pnpm eval:sim --empty --reps 1`)

Kai starts practice with an empty notebook; after each wrong answer the learner writes one correction. Data: `data/eval-sim-2026-11-14T00-25-24.json`. $0.08.

```
TOTAL gate 5/24 (all shut, as they should be with nothing taught), Kai wrong at least once in 8/8,
Kai solved 2 first try + 9 after a fix (should 19), right when the gate was open 2/2
```

| Problem | Needs | Fixed by one correction |
|---|---|---|
| p7 | n05.f1 | 6 of 7 learners who know it (partial learner: n05.f1 partial) |
| p2 | n12.f1, n12.f2 | 3 of 7 (the others: n12.f2 partial or missing; the terse learner's correction gave a wrong answer itself) |
| p3 | n06.f1, n12.f1, n12.f2, n11.f1 | 0 of 7: one correction can't carry four facts; the rambler's p7 correction taught everything, so its p3 and p2 were right the first time |

- **The new correction prompt reads well:** corrections that explain the idea ("greedy never retries cake A after its unlucky 3, so its average never gets corrected") are credited like teaching and open the gate on the retry.
- **n12.f2 in corrections:** "a bonus that grows with ln t" was partial (expert), "keep growing slowly through the ln t term" correct. Same rule as in teaching (the slowing has to be said), but an expert's "ln t" arguably states it; consider adding `\bln t\b|\bwith ln\b` to n12.f2's evidence only if the team agrees "grows with ln t" means "more and more slowly".
- **The misled learner's wrong corrections** ("the averages correct themselves", "every bonus shrinks each round") credited no fact and recorded **no misconception** (0/3 caught), and "sticks with the best one forever" got n05.f1 *partial*. Kai stays wrong, so practice is unaffected; the notebook just doesn't show the wrong belief.
- p3 never being fixed in one correction is a property of the problem (four needed facts), not a bug. Worth knowing for the analysis: in the recursive condition, a learner who taught little will rarely see Kai get p3 right.

## 4. The solver (`pnpm eval:solver --items p7,p3,p2 --reps 10 --audit`)

Claude Haiku 5.5, 230 attempts (23 cases × 10). Data: `data/eval-solver-2026-11-14T00-31-32.json`. $0.19.

```
as predicted 230/230, by the model 228/230, 2 to 5 steps 226/228, with nothing taught at most 3 18/30
where a fact was missing: says it is guessing 172/178, lesson terms it wasn't given 4
audit: uses a fact it wasn't told 97/178, says it is guessing 158/178
median 5097 ms, slowest 20376 ms
```

| Problem | Full notebook (≥ 9/10) | Without each needed fact (≥ 8/10 on its wrong answer) | Vague, skipped, misconception |
|---|---|---|---|
| p7 | 10/10 | n05.f1 10/10 | all 10/10 as predicted |
| p3 | 10/10 | n06.f1, n12.f1, n12.f2, n11.f1: 10/10 each | all 10/10 |
| p2 | 10/10 | n12.f1, n12.f2: 10/10 each | all 10/10 |

**The handoff's bar is met everywhere.**

- **The audit's "uses a fact it wasn't told" (97/178) is the audit misreading, not Kai.** Every flagged attempt read (p7 skipped, p3 without n06.f1, p3 without n12.f2, p2 without n12.f1, p2 with the n12.f2 misconception) reasons from Kai's own guess or the misconception it was given, the *opposite* of the fact. The audit names the fact anyway: "I'd guess a bonus just stays put while its option isn't picked" was flagged as using "the bonus grows with the round number t". As it stands the audit can't separate a fact from its negation; its prompt needs to ask whether the step *states the fact as true* (or the number dropped from the report until it does).
- **The 4 leaks** are all p2 with nothing taught, the term "bonus shrinks", which is in Kai's own hunch for n12.f1 ("every bonus shrinks as rounds pass"). A false positive of the term check, harmless.
- **With nothing taught, 12 of 30 attempts took 4 steps** (p7 5 times, p3 7 times) instead of the 2 or 3 the prompt asks for. Cosmetic: the answers are right for the wrong reason as intended, just one step longer.
- **Retries:** p3 with the n11.f1 misconception was right without the fact 5 times in the first try; the stricter retry then gave the predicted wrong answer each time. Two attempts in all went to the offline attempt (one "not an option": "Both cafés").

## 5. By hand: a terse and a thorough teacher

`pnpm chat` drives the older policy Kai (`takeTurn`), not the scripted questions the bandits pack uses in the app (`takeScriptTurn` in `app/api/chat/route.ts`). So these two conversations ran through a small driver around `takeScriptTurn` with the live judge and reaction writer, the learner's messages taken word for word from the pilot runs. (Worth updating `scripts/chat.ts` to the scripted path.)

**Terse** (P_afterFix2worseanswers' seven messages), $0.013:

| Message | Credit | Wanted |
|---|---|---|
| "Greedy can lock in on the wrong arm with an unlucky start." | n06.f1 partial (no evidence of the key) | partial ✓ |
| "UCB uses a mean and a bonus, and the bonus is higher for less explored options…" | n11.f1 partial (no evidence) | partial ✓ |
| "It's for exploration, for the trade off." (the bonus question) | nothing | partial; harmless, see #22 above |
| "yeah the bonus grows with T rounds and shrinks if it is picked." | n12.f1 correct, n12.f2 partial | ✓ |

Gate: p7 open, p3 shut, p2 open (p2 through its vague reading of n12.f2, by design). No misconception. Reactions said back the latest message only.

**Thorough** (P_TestAfterFixes1's messages), two runs, $0.015 each:

| Message | Credit | Wanted |
|---|---|---|
| Greedy's rule | n05.f1 correct | ✓ |
| Lock-in with an example, then the lucky leader | n06.f1 **partial**, n06.f2 correct, **misconception** (n06 in run 1, n05 in run 2) | n06.f1 correct, no misconception ✗ (Problems 1 and 2) |
| UCB's score, "increases logarithmically", "the bonus for exploration becomes lower" | n11.f1, n12.f2, n12.f1 correct | ✓ |
| The bonus question ("prioritizes arms that have been explored less") | n11.f4 partial | ✓ (no doubt about the average) |

Gate: p7 open, **p3 shut**, p2 open. A learner who taught everything gets a Kai that fails p3 for a reason the learner can't see.

## Not run, or not run as written

- **Unit tests and the e2e walkthrough.** This machine has Node 20.6; the project needs Node 22 (`engines`). Dependencies were installed under 20.6, which skipped rolldown's Windows binding, so `vitest` can't start. The evals ran under a portable Node 22.12 with `tsx` directly (pnpm isn't installed globally here). `tsc --noEmit` passes. `pnpm content validate bandits`: 0 errors, 6 warnings (all known: stale locations, three facts outside the videos, one test form, `ucb-why` waits for "bonus"). `next build` succeeds. The e2e ran through every participant flow and the admin panel (40 screenshots in `.e2e/`), then hung with its own process at full CPU before printing its checks; not diagnosed (Windows-specific, Phil reports it passing). To run the tests here: install Node 22, then `pnpm install` again.
- **`.env`** began with a Markdown code fence (```` ``` ````), which made Node read the OpenRouter key as part of a junk variable name, so every live script fell back to "key not set". Fixed by hand before these runs.

## Cost

About $0.75 in all: judge eval and probes ≈ $0.05, teaching sim $0.40, corrections sim $0.08, the by-hand conversations $0.04, solver $0.19.

## Next steps, in order

1. Fix Problem 1 (n06.f1 evidence across the answer, or n06.f2 carrying n06.f1), with the three messages as tests; rerun `pnpm eval:judge --reps 3` and the thorough conversation.
2. Fix Problem 2 (a code check that drops the lucky-leader "misconception"), with case #21 and the thorough message as tests.
3. Then `pnpm test && pnpm typecheck`, `pnpm build && pnpm e2e` on a machine with Node 22, and `pnpm eval:sim --reps 2 --solve` once more: the gate should reach 45/48 (the two terse p3 shuts are intended; the misled p7 open is Problem 3).
4. Smaller, after the study can wait: Problem 3, the solver audit's prompt, `scripts/chat.ts` on the scripted path, and the eval-sim knowledge sheet for the terse learner (so intended partials stop counting as gate misses).

Both fixes are checks around the judge; they change no fact, question, test item or time, so by the handoff they don't need Phil's team first. Note each in CLAUDE.md (dated) and commit them one at a time.

## Raw output

The sim and solver data are in `data/eval-sim-2026-11-14T00-28-41.json` (teaching), `data/eval-sim-2026-11-14T00-25-24.json` (corrections from scratch) and `data/eval-solver-2026-11-14T00-31-32.json`, gitignored with the rest of `data/`. The console output of each run and the two scratch drivers (the judge probe and the scripted conversation) were kept in the session's scratch folder, not in the repo.

## Update, same day: the bugs found, the fixes and every check rerun

All the fixes are checks in code around the judge (the AI still judges; code checks its verdicts). No fact, question, test item or time changed. Tests for each are in `tests/judge.test.ts`, the dated notes in CLAUDE.md.

| Problem (first pass) | Fix | Where |
|---|---|---|
| 1. A full lock-in explanation was only partial, so p3's gate shut for a learner who taught it well | The evidence check reads the credited sentence with one before and two after, not the sentence alone. And a fact can be a worked example of another (`exampleOf`, n06.f2 → n06.f1): a correct example whose sentences hold lock-in's evidence credits lock-in too. Terse answers with no "never … again" anywhere stay partial. | `settleReply`, `creditExamples` in `engine/tutor/judge.ts`; `exampleOf` in the graph |
| 2. The lucky-leader remark was recorded as a misconception | Per-idea `trueRemarks` patterns (n05, n06: a leader that "only got lucky", the picked option's average converging or falling back): a misconception whose sentence, or the one before, matches is dropped and logged. "The averages fix themselves, it always ends up on the best" stays a misconception. | `screenMisconceptions`, `isTrueRemark`; `trueRemarks` in the graph |
| 3. "Sticks with that one forever, never switches" didn't block greedy's rule | Per-fact `against` patterns, the fact's wrong reading in words: a message that also says one doesn't teach the fact (a correct verdict becomes partial, a partial one is dropped). n05.f1: sticks with one for good, never switches. n12.f2: a skipped option's bonus stays the same (a misled correction had got the growing bonus as partial, which opened p2 through its vague reading). Tried on every sim message of the day: no hit on 102 verdicts from learners who knew the fact. | `contradicted`; `against` in the graph |
| Found on the way: false credit on "the bonus is calculated based on how often we have chosen the option" (2 of 3 runs) | n12.f1 (a pick shrinks its bonus) needs a direction: an evidence pattern ("smaller", "lower", "fewer", "/n"…) | `evidence` of n12.f1 |
| Found on the way: the judge copies the KEY text as its key words (3 of 6 runs on the pilot's "…prevent the Greedy rule from choosing this option again") | When the key quote is the key's own text, the credited words stand in, if their own sentences hold the fact's evidence | `settleReply` |
| The solver audit read Kai's guesses as using the facts (97/178 flags, all false) | The audit is given Kai's own guess for each missing fact and asked whether a step states the fact as true | `scripts/eval-solver.ts` |
| `pnpm chat` drove the older chosen-question Kai | It now uses the pack's fixed questions, as the app does, and prints the checks | `scripts/chat.ts` |
| The e2e walkthrough hung on Windows after its checks | `browser.close()` gets 5 s, then Chrome is ended | `scripts/e2e.mjs` |

Tried and left out: showing the judge each fact's `assume` as a "common wrong belief". It didn't pin "never switches" to greedy's rule, and it made the judge read a terse "keeps sticking with whatever has the best average" as a wrong belief, which shut p7 (the same trade-off CLAUDE.md records from an earlier try).

**Before and after**, the same commands:

| Check | First pass | After the fixes |
|---|---|---|
| Judge: false credit | 0 | **0** |
| Judge: facts found | 59/66 | **63.5/66** (misses: c, which left the lesson; #22 gets no verdict instead of a harmless partial) |
| Judge: misconceptions | 22/24 | **24/24** |
| Judge #6, lock-in shown by an example | partial 3/3 | **correct 3/3** |
| Judge #18, the pilot's "…choosing this option again" | partial 1/3 | **correct 3/3** (and 6/6 in a separate probe) |
| Judge #21, the lucky leader | misconception 2/3 | **none 3/3** |
| Thorough conversation (P_TestAfterFixes1's messages), 4 runs | lock-in partial, a misconception, p3 shut | **lock-in correct, no misconception, all three gates open** |
| Terse conversation (P_afterFix2's messages), 3 runs | lock-in, UCB's rule and the slowing growth partial | **unchanged, as intended** (p3 stays shut) |
| Teaching sim: gate right | 44/48 | **46/48** (the two misses below) |
| Teaching sim: false credit | 2 | **1** |
| Teaching sim: recall | 83/86 | 82/86 |
| Teaching sim: wrong beliefs caught | 5/6 | 5/6 |
| Teaching sim: vague as full | 0 | 4 (see below) |
| Teaching sim: Kai wrong at least once; right only with the gate open | 16/16; 27/27 | **16/16; 26/26** |
| Corrections from scratch: fixed by one correction | 9 of 19 | **12 of 19**; the misled learner's false open on p2 is gone |
| Solver: as predicted | 230/230 | **230/230** |
| Solver audit: "uses a fact it wasn't told" | 97/178 (false alarms) | **1/180** (itself a misreading) |
| Unit tests | couldn't run here | **225 passed** (223 before the new ones) |
| Typecheck, `content validate`, build | pass | **pass** (0 errors, the 6 known warnings) |
| e2e walkthrough (demo Kai) | hung | **51 checks pass, no page errors** |

**What's left, and why it stays:**
- **Gate misses (2 of 48).** The terse learner's "It can get stuck if the best option had an unlucky first result" is partial by design: nothing says the option is never tried again. One misled run said "never switching" (caught: n05.f1 wrong) and then "It always picks the option with the best average", which is greedy's rule and, by the existing rule, retires the earlier wrong belief.
- **Vague as full (4).** Three are n12.f2: the simulated half-remembering learners wrote "skipped options … slowly grow". n12.f2's evidence takes a bare "slowly", and learners who know the fact say "keeps growing, only slowly" just as often (rambler and chatty, three times), so tightening it would trade these for lost real credit. The fourth is a learner whose message stated UCB's full rule. None comes from the wider window: in all four the quoted sentence itself has the words.
- **Recall 82/86** is within run-to-run noise: two terse lock-ins (intended), the expert's exploring fact skipped once by the judge (a fact with no checks around it), and the misled learner's one known fact.
- **The terse learner's "lower for better exploit options"** is sometimes recorded as a misreading of UCB's bonus. It isn't pinned to a fact, so it blocks nothing.
- **One p7 correction got a wrong retry:** "the answer is option B, A on day 5" was answered A. Truck A and option A share a letter. Seen once.

**How the tests were run here.** This machine has Node 20.6 and no pnpm; the project needs Node 22. Everything ran under a portable Node 22.12 with the installed tools called directly. Vitest's bundler binding was skipped by the Node 20 install, so the unit tests ran through a small stand-in for `describe`/`it`/`expect` (it fails on a wrong expectation, checked). On a machine with Node 22, `pnpm install` and `pnpm test` run them the normal way. Nothing is committed or pushed.

Second-pass cost about $1.80 (judge evals and probes, three teaching sims, two correction sims, the conversations, one solver run); the day about $2.50.

### How it went, in order

1. **Evidence window and examples (Problem 1 and 2).** Thorough conversation rerun twice: lock-in correct, the lucky-leader "misconception" dropped as a true remark, p7, p3 and p2 all open. Terse unchanged. Judge eval: facts 62/66 (from 59), misconceptions 24/24, but false credit 2: case #19 had n12.f1 credited for "the bonus is calculated based on how often we have chosen the option". Not caused by the change (n12.f1 had no check), so n12.f1 got an evidence pattern.
2. **A "common wrong belief" line in the judge's prompt (for Problem 3).** Judge eval looked best yet (65.5/66, false credit 0), but a three-learner sim showed it didn't move "never switches" to greedy's rule, and a later full sim showed it made the judge read a terse "keeps sticking with whatever option has the best average" as a wrong belief, which shut p7. Removed.
3. **`against` patterns (Problem 3).** First version: no false hit on 26 messages from learners who knew greedy's rule. The next corrections sim showed two things: "greedy *doesn't* stick with its first pick" was caught (a missing negation guard, fixed), and a misled correction ("Flashcards and Listening don't get picked, so their bonuses and scores don't change") got n12.f2 as partial, which opened p2 through its vague reading. So `against` also drops a partial verdict, and n12.f2 got patterns. Second version: no hit on 102 verdicts from learners who knew the fact, 8 of 10 of the misled learner's statements caught.
4. **The copied key.** Case #18 was partial in 2 of 3 runs: the judge had put the KEY's own text in `keyQuote`. A probe confirmed it (3 of 6), the fallback fixed it (6 of 6).
5. **Considered and left:** tightening n12.f2's evidence (no bare "slowly"). Every sim message it would change was listed: three from learners who knew the fact would lose real credit, two from half-remembering ones would stop being over-credited. Left as is.
6. **The e2e hang.** A copy of the script with progress marks showed every check done by the time it stuck in `browser.close()`. With a 5 s limit on close, the walkthrough passes. A second run on the same server failed at the admin login only because of the login limit (5 tries per 15 minutes per server process); one run per fresh server passes.
7. **Final round** on the final code: everything in the table above.

### Files changed (uncommitted)

| File | Change |
|---|---|
| `engine/tutor/judge.ts` | `sentencesOf` takes a window; the evidence check reads it; `creditExamples`, `contradicted`, `isTrueRemark`; the copied-key fallback; a note on the prompt line that was tried and left out |
| `content/schema.ts` | new optional fields: `exampleOf` and `against` on facts, `trueRemarks` on ideas (graph and bundle) |
| `content/pack.ts` | `content validate` checks them: an example's fact must have evidence, every pattern must compile |
| `topics/bandits/graph.draft.json` | n06.f2 `exampleOf` n06.f1; `trueRemarks` on n05 and n06; `against` on n05.f1 and n12.f2; `evidence` on n12.f1 |
| `topics/bandits/bundle.json` | rebuilt (`pnpm content bundle bandits`) |
| `topics/bandits/coverage.json` | `graphHash` brought up to date (no fact's text changed) |
| `tests/judge.test.ts` | 11 new tests, each from a message seen in the runs (225 tests in all, from 214) |
| `scripts/eval-solver.ts` | the audit sees Kai's own guess for each missing fact |
| `scripts/chat.ts` | the pack's fixed questions, as in the app; prints the checks |
| `scripts/e2e.mjs` | 5 s limit on closing Chrome |
| `CLAUDE.md` | dated notes on all of the above |

Data from the runs (gitignored): `data/eval-sim-2026-11-14T01-04-00.json` (final teaching sim), `data/eval-sim-2026-11-14T00-55-33.json` and the following one (corrections from scratch), `data/eval-solver-2026-11-14T00-54-20.json` (solver with the new audit).

### Before Monday

- Commit the changes (one per fix, as CLAUDE.md asks) and push only when the team agrees and no pilot is running: pushing deploys the live site.
- The handoff's own list still stands: the team code (`ACCESS_AS_PILOT_DEFAULT` or `PILOT_CODE`), Study setup, participant codes and the OpenRouter credit.
- On a machine with Node 22: `pnpm install`, then `pnpm test` with vitest itself.
