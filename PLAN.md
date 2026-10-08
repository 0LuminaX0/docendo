# Docendo plan

- Design history and research grounding: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP
- Phil's handoff, triaged item by item: https://claude.ai/artifact/CobG3jpsLRdSPhBnzumNej
- Rules: [CLAUDE.md](CLAUDE.md); deploy: [README.md](README.md)

## Where we are (2026-10-08)

The study compares recursive and direct feedback (Okita & Schwartz 2013, Exp. 2). Both conditions run end to end at MVP depth.

| Part | State |
| --- | --- |
| Start | Access by participant code (condition inside the code, balanced blocks of 4) or the shared team code; consent note |
| Pretest | Done: 2 background questions (RL course flags `excluded`) and 3 knowledge items with "I don't know"; nothing shown back |
| 1 Watch | Done: 8:12 lesson, three video parts in one player |
| 2 Teach Kai | Done: judge with quote check (facts and open-ended misconceptions), notebook, policy, writer with term filter, readiness 80% or 50% after 8 min, Kai's mind; participants can stop after 12 messages or 8 min |
| 3 Practice, direct | Done: 2 rounds × 3 problems, two tries, Rewatch, 10 min, then the test |
| 3 Practice, recursive | First version, with a code-enforced gate (Kai is right only with every needed fact taught correctly; otherwise a guess that can't hit the key): Kai solves with the LLM from its notes, light, click a step to see the notes behind it, one correction (judged like teaching), second try; offline fallback; team sessions switch views |
| 4 Final test | Done: 10 MCQs checked against the item rules; results with explanations and practice solutions |
| Research log | Done: every turn, try, click and video event; notebook snapshots; `pnpm events export` |
| Checks | 78 unit tests (incl. recomputed keys), `pnpm e2e` (23 browser checks on its own safe server, including a scan of everything the browser downloads for solutions, explanations and lesson facts) |

## Next, in order

1. **Pilot the direct pipeline** with 2–3 people on the real model, on participant codes: total time, judge quality on real explanations, the export.
2. **Recursive practice, second pass**: steps revealed one by one; a verifier model on each step (now only a term check); check over several runs that Kai's mistakes follow the notebook (Phil's rf-pipeline-test). Verified so far (2026-10-08, live model in the browser): a taught misconception makes Kai go wrong at that step, clicking it shows the learner's quote, one correction makes Kai right; 2.5 to 5.6 s per call.
3. **Leak check** (the TA's manipulation check): an LLM audit of every Kai message and solution step after the study, with the leak rate.
4. Before the study: a team member who didn't write them reviews practice and test items; the M3 report is being updated by Phil (it still says 8 problems, unlimited checks, solutions during practice, 35 min, no pretest).

## Decided and dropped

- Prompted-vs-managed design (dropped 2026-10-08 for recursive vs direct feedback).
- Prewritten Kai solution variants and fixed misconception ids (Phil's handoff): misconceptions arise while explaining; the LLM keeps that job.
- A second "acknowledge" teaching mode, the paste block, Phil's T1 and T2 test items.
- The LLM authoring pipeline (draft, locate, verify, review, freeze) is not part of the study flow: stashed in `content/authoring/` with its outputs, for building new topics later.
