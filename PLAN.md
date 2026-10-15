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
| 4 Final test | Two parallel forms (A, B) of 10 items (6 choice, 4 typed numbers) made to need the rules, not common sense; choice items first, each part shuffled per learner; a working field under each; results with feedback first, missed questions first, explanations and practice solutions |
| Delayed test | Infrastructure only, off until `DELAYED_TEST_DAYS` is set: the other form, days later, with the same one-time code or on the same device; balanced A/B order per condition; a "studied it since?" question; summarised apart on the dashboard |
| Consent | A checkbox on the welcome page; the server refuses a session without it |
| Admin | `/admin`: dashboard, sessions with detail, access codes, feedback, CSV/JSONL export |
| Research log | Every turn, try, click, video and calculator event; notebook snapshots; `pnpm events export` |
| Checks | 101 unit tests, `pnpm e2e` (33 browser checks, incl. consent, the delayed test, the admin panel and phone layouts), live evals: `pnpm eval:judge` (45/45), `pnpm eval:solver` (30/30), `pnpm eval:chat` |

## Next, in order

1. **Deploy and pilot** with 2–3 people: set `ADMIN_PASSWORD` on Vercel, make codes in the panel (random, one use each), and watch the dashboard: total time, how far people get, item difficulty (aim for about half correct), Kai's first-try rate.
2. **Recursive practice, second pass** after the pilot: a verifier model on each step (now a term check), and `pnpm eval:solver --reps 5` on real pilot notebooks.
3. **Leak check** (the TA's manipulation check): an LLM audit of every Kai message and solution step after the study, with the leak rate.
4. After deploying: sign in to `/admin` and make one test code (the Upstash path for codes and participant records has only run locally), then delete it.
5. **Delayed test: decide** whether to run it and after how many days (then set `DELAYED_TEST_DAYS`), and review form B's ten items (r01 to r10 in `exercises.json`) as a team. Participants need one-time codes (one use each) for it: shared codes name nobody.

## Decided and dropped

- Prompted-vs-managed design (dropped 2026-10-08 for recursive vs direct feedback).
- Prewritten Kai solution variants and fixed misconception ids (Phil's handoff): misconceptions arise while explaining; the LLM keeps that job.
- A second "acknowledge" teaching mode, the paste block, Phil's T1 and T2 test items.
- The LLM authoring pipeline (draft, locate, verify, review, freeze) is not part of the study flow: stashed in `content/authoring/` with its outputs, for building new topics later.
