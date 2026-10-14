# Docendo plan

- Design history and research grounding: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP
- Phil's handoff, triaged item by item: https://claude.ai/artifact/CobG3jpsLRdSPhBnzumNej
- Rules: [CLAUDE.md](CLAUDE.md); deploy: [README.md](README.md)

## Where we are (2026-10-14)

The study compares recursive and direct feedback (Okita & Schwartz 2013, Exp. 2). Both conditions run end to end, with an admin panel for the pilot.

| Part | State |
| --- | --- |
| Start | Access codes made in the admin panel (condition direct, recursive or random-balanced; uses per code), the older HMAC codes, or the shared team code |
| Pretest | 2 background questions (RL course flags `excluded`) and 3 knowledge items with "I don't know" |
| 1 Watch | 8:12 lesson, three video parts in one player |
| 2 Teach Kai | Judge (facts, open-ended misconceptions, quote check), notebook, policy, writer with term filter, readiness 80% or 50% after 8 min; Kai's mind shows the lesson's 9 ideas inside the topic's 19-idea tree (the others dimmed, credited as bonus if explained) |
| 3 Practice, direct | 2 rounds × 3 problems, two tries, working with a calculator, Rewatch, 10 min |
| 3 Practice, recursive | Kai solves (Claude Haiku 5.5) from its notebook: 3 to 5 steps beside a live notebook, light, one correction (judged like teaching; the notebook strikes through and rewrites), second try. Gate: right only with every needed fact taught correctly; otherwise Kai reasons from a beginner's wrong rule, so the mistake follows from its steps |
| 4 Final test | 10 MCQs checked against the item rules, with the same calculator; results with explanations, practice solutions and a feedback box |
| Admin | `/admin`: dashboard, sessions with detail, access codes, feedback, CSV/JSONL export |
| Research log | Every turn, try, click, video and calculator event; notebook snapshots; `pnpm events export` |
| Checks | 91 unit tests, `pnpm e2e` (27 browser checks, incl. the admin panel and phone layouts), live evals: `pnpm eval:judge` (45/45), `pnpm eval:solver` (30/30), `pnpm eval:chat` |

## Next, in order

1. **Deploy and pilot** with 2–3 people: set `ADMIN_PASSWORD` on Vercel, make codes in the panel (random, one use each), and watch the dashboard: total time, how far people get, item difficulty (aim for about half correct), Kai's first-try rate.
2. **Recursive practice, second pass** after the pilot: a verifier model on each step (now a term check), and `pnpm eval:solver --reps 5` on real pilot notebooks.
3. **Leak check** (the TA's manipulation check): an LLM audit of every Kai message and solution step after the study, with the leak rate.
4. After deploying: sign in to `/admin` and make one test code (the Upstash path for codes has only run locally), then delete it.

## Decided and dropped

- Prompted-vs-managed design (dropped 2026-10-08 for recursive vs direct feedback).
- Prewritten Kai solution variants and fixed misconception ids (Phil's handoff): misconceptions arise while explaining; the LLM keeps that job.
- A second "acknowledge" teaching mode, the paste block, Phil's T1 and T2 test items.
- The LLM authoring pipeline (draft, locate, verify, review, freeze) is not part of the study flow: stashed in `content/authoring/` with its outputs, for building new topics later.
