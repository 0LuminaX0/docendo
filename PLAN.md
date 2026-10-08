# Docendo plan

- Design history and research grounding: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP
- Phil's handoff, triaged item by item: https://claude.ai/artifact/CobG3jpsLRdSPhBnzumNej
- Rules: [CLAUDE.md](CLAUDE.md); deploy: [README.md](README.md)

## Where we are (2026-10-08)

The study compares recursive and direct feedback (Okita & Schwartz 2013, Exp. 2). The MVP is the **direct-feedback pipeline, end to end**; the recursive condition is built next, on the same hooks.

| Part | State |
| --- | --- |
| Start | Access by participant code (condition inside the code, balanced blocks of 4) or the shared team code; consent note |
| Pretest | Done: 2 background questions (RL course flags `excluded`) and 3 knowledge items with "I don't know"; nothing shown back |
| 1 Watch | Done: 8:12 lesson, three video parts in one player |
| 2 Teach Kai | Done: judge with quote check (facts and open-ended misconceptions), notebook, policy, writer with term filter, readiness 80% or 50% after 8 min, Kai's mind; participants can stop after 12 messages or 8 min |
| 3 Practice, direct | Done: 2 rounds × 3 problems, two tries, Rewatch, 10 min, then the test |
| 3 Practice, recursive | Not built (hooks: `steps[].facts`, notebook with misconceptions, `cond` in the token) |
| 4 Final test | Done: 10 MCQs checked against the item rules; results with explanations and practice solutions |
| Research log | Done: every turn, try, click and video event; notebook snapshots; `pnpm events export` |
| Checks | 70 unit tests (incl. recomputed keys), `pnpm e2e` (21 browser checks on its own safe server, including a scan of everything the browser downloads for solutions, explanations and lesson facts) |

## Next, in order

1. **Pilot the direct pipeline** with 2–3 people on the real model, on participant codes: total time, judge quality on real explanations, the export.
2. **Recursive practice**: Kai solves each problem with the LLM from its notebook only (closed world: numbered quotes, no lesson facts), shown step by step with the light; on red the learner clicks the faulty step and sees the notebook statement; one correction in the chat (judged like teaching), then one retry. Same problems, time and tries as direct.
3. **Leak check** (the TA's manipulation check): an LLM audit of every Kai message and solution step after the study, with the leak rate.
4. Before the study: a team member who didn't write them reviews practice and test items; the M3 report is being updated by Phil (it still says 8 problems, unlimited checks, solutions during practice, 35 min, no pretest).

## Decided and dropped

- Prompted-vs-managed design (dropped 2026-10-08 for recursive vs direct feedback).
- Prewritten Kai solution variants and fixed misconception ids (Phil's handoff): misconceptions arise while explaining; the LLM keeps that job.
- A second "acknowledge" teaching mode, the paste block, Phil's T1 and T2 test items.
- The LLM authoring pipeline (draft, locate, verify, review, freeze) is not part of the study flow: stashed in `content/authoring/` with its outputs, for building new topics later.
