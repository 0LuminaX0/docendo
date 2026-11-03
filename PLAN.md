# Docendo plan

- Design history and research grounding: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP
- Phil's handoff, triaged item by item: https://claude.ai/artifact/CobG3jpsLRdSPhBnzumNej
- Rules: [CLAUDE.md](CLAUDE.md); deploy: [README.md](README.md)

## Where we are (2026-10-14)

The study compares recursive and direct feedback (Okita & Schwartz 2013, Exp. 2). Both conditions run end to end, with an admin panel for the pilot.

| Part | State |
| --- | --- |
| Start | Access codes made in the admin panel (condition direct, recursive or random-balanced; uses per code), the older HMAC codes, or the shared team code |
| Pretest | The team's option C: 3 screening questions (an RL course or knowing a bandit algorithm flags `excluded`) and set C1, 5 knowledge items with "I don't know"; the harder set C2 for the pilot (`pretest.both`: both sets as two parts, order alternating with the test form) |
| 1 Read (was Watch) | The team's text lesson (lesson.json, 2026-11-02): 5 sections, 3 formulas, 5 figures; not selectable, Continue after 4 min, closed once left; paste off in the chat, Kai's fixed reply to text copied word for word (15 words in a row), overlap logged per turn. Without lesson.json: 8:12 lesson, three video parts in one player |
| 2 Teach Kai | Kai asks nine fixed questions (script.json, 2026-11-02) and repeats back what it wrote down in the learner's words, one "say more" after a short answer, ready after the last question or 10 min; judge (facts, open-ended misconceptions, quote check) and notebook as before. Without script.json: policy, writer with term filter, readiness 80% or 50% after 8 min; Kai's mind shows the lesson's 9 ideas inside the topic's 19-idea tree (the others dimmed, credited as bonus if explained) |
| 3 Practice, direct | 2 rounds × 3 problems, two tries, working with a calculator, Rewatch, 10 min |
| 3 Practice, recursive | Kai solves (Claude Haiku 5.5) from its notebook: 3 to 5 steps beside a live notebook, light, one correction (judged like teaching; the notebook strikes through and rewrites), second try. Gate: right only with every needed fact taught correctly; otherwise Kai says it is guessing and reasons from its fixed assumption for the first missing fact (one known misconception per teachable fact, 2026-11-02), so the mistake follows from its steps and has a named cause. Problems P1 to P6 from the team's item design |
| 4 Final test | The team's post-test: form A (T1 to T10) and form B (V1 to V10, harder), options that state predictions only, each item with "I don't know" and a written reason (scored later against its rubric; `reasons.csv` for blind scoring), three multi-select items scored all or nothing; each form shuffled per learner; results with feedback first, the score per part, missed questions first with the learner's reason, explanations and practice solutions. Pilot (`test.both`): both forms after the lesson in two parts, the session's own form first, part 1 locked once done, the anchor (V9 = T10) asked once |
| Delayed test | Infrastructure only, off until `DELAYED_TEST_DAYS` is set: the other form, days later, with the same one-time code or on the same device; balanced A/B order per condition; a "studied it since?" question; summarised apart on the dashboard; not after a final test with both forms (the pilot) |
| Consent | A checkbox on the welcome page; the server refuses a session without it |
| Admin | `/admin` with a sidebar: a dashboard of charts (balance, funnel, scores and a preliminary comparison, pretest against test, survey and manipulation check, data quality), sessions with detail, access codes, feedback, Settings (versioned, logged per session), CSV/JSONL export |
| Survey | Six questions after the test, before the score (effort, responsibility, judged understanding, practice, enjoyment, manipulation check); optional |
| Research log | Every turn, try, click, video and calculator event; notebook snapshots; `pnpm events export` |
| Checks | 105 unit tests, `pnpm e2e` (37 browser checks, incl. consent, the survey, a second tab, settings, the delayed test, the admin panel and phone layouts), live evals: `pnpm eval:judge` (45/45), `pnpm eval:solver` (30/30), `pnpm eval:chat` |

## Next, in order

0. **Settings mid-study.** A session records the settings version it started under, but a change applies to sessions already running (within seconds). Change settings between participants, not during a lab slot; the dashboard's per-version session counts make any mix visible.

1. **Deploy and pilot** with 2–3 people: set `ADMIN_PASSWORD` on Vercel, make codes in the panel (random, one use each), and watch the dashboard: total time, how far people get, item difficulty (aim for about half correct), Kai's first-try rate.
2. **Recursive practice, second pass** after the pilot: a verifier model on each step (now a term check), and `pnpm eval:solver --reps 5` on real pilot notebooks.
3. **Leak check** (the TA's manipulation check): an LLM audit of every Kai message and solution step after the study, with the leak rate.
4. After deploying: sign in to `/admin` and make one test code, then delete it; save and reset the settings once (the Upstash path for codes, participant records and settings has only run locally).
5. **After the pilot: the test.** Keep, item by item, the version (T or V) that lands between about 30% and 70% correct and separates participants who taught well from those who did not (the team's plan; the dashboard shows each item's share correct, the export each item's answers by form and the reasons), then switch `test.both` off for the study. **Delayed test: decide** whether to run it and after how many days (then set `DELAYED_TEST_DAYS`). Participants need one-time codes (one use each) for it: shared codes name nobody.

## Decided and dropped

- Prompted-vs-managed design (dropped 2026-10-08 for recursive vs direct feedback).
- Prewritten Kai solution variants (Phil's handoff): misconceptions the learner states arise while explaining; the LLM keeps that job. Changed 2026-11-02: what Kai assumes for a fact nobody explained is fixed per fact (one known misconception each), so each practice item's wrong options can be checked to follow from one named cause (`pnpm eval:solver`).
- A second "acknowledge" teaching mode, Phil's T1 and T2 test items. The paste block was dropped with the videos; it is back for the text lesson (2026-11-02), since a text can be pasted into the chat.
- The LLM authoring pipeline (draft, locate, verify, review, freeze) is not part of the study flow: stashed in `content/authoring/` with its outputs, for building new topics later.
