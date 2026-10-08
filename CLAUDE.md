# Docendo

Learning-by-teaching study for CS-411 Digital Education (EPFL). Team: Andrii Negrub, Phil Gustke, Rafael Cruz. A learner watches a short lesson on multi-armed bandits, teaches it to an AI classmate ("Kai", placeholder name) until Kai feels ready, practises, then takes a final test. Next.js app on Vercel: https://docendo-jade.vercel.app.

Design history: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP. Status and next steps: [PLAN.md](PLAN.md). Phil's handoff triage: https://claude.ai/artifact/CobG3jpsLRdSPhBnzumNej.

## The study

A conceptual replication of Okita & Schwartz (2013, JLS, doi 10.1080/10508406.2013.807263) Experiment 2, *recursive vs direct feedback*, with an LLM teachable agent. Both conditions watch the same lesson and teach Kai the same way; only the practice chapter differs:
- **Direct feedback (built, the MVP):** the learner solves the problems, a first try and one retry each, with a right/wrong light.
- **Recursive feedback (later):** Kai solves the same problems from its notebook (the learner's quotes and misconceptions), with the LLM, not prewritten variants: misconceptions arise while explaining and can't be listed in advance. Each solution gets the light; on a wrong one the learner clicks the faulty step and sees the notebook statement behind it.
Worked solutions come on the results page after the final test, in both conditions. Session ≈ 42 min: pretest 2, watch 10, teach 10, practice 10, test 10.

**Build to one level.** The MVP is the direct-feedback pipeline end to end, at the same depth everywhere. Don't build ahead for the recursive condition beyond what its later build needs as a hook (`steps[].facts` in practice.json, the notebook, `cond` in the token). Dead code (unused functions, fields) can go; whole tools that cost effort to build or whose outputs took effort to generate are stashed, not deleted (the user's rule, 2026-10-08), like the authoring pipeline in `content/authoring/` with its outputs.

**Conditions come from participant codes.** Each participant gets their own access code; an HMAC of the code under `CODE_SECRET` gives a check part and the condition bit (`lib/codes.ts`), so the server keeps no table or counter. `pnpm codes 40` writes balanced blocks of 4 to `data/codes-*.csv` (team only). The shared `ACCESS_CODE` is for the team and demos: direct condition, test shortcuts on (`team` in the browser). The token carries `cond`, `entry` (participant, team, open) and `pid` (the code's id); the browser learns only `team`. Until the recursive practice exists everyone practises in the direct condition (`practiceAs` in `session_start`).

**Teammates' proposals:** judge them on their merits. Don't adopt one because it is more deterministic: keep the AI for judging and Kai's reasoning, and use code for the checks around it.

## The app, in four chapters

0. **Before you start** (`/pretest`, `topics/bandits/pretest.json`): two background questions (an RL course flags the session `excluded`; it continues) and three knowledge items on neighbouring ideas (an average payoff, regret, what exploiting means), each with "I don't know". Graded and logged by `/api/grade` (`kind: "pretest"`); nothing is shown back; no step bar.
1. **Watch** (`/watch`): one lesson of 8:12, three parts of two YouTube videos played back to back in one player (YouTube IFrame API; plain embeds as fallback).
2. **Teach Kai** (`/teach`): a chat until Kai feels ready. Kai's mind (`/mind` and a toggle) shows what Kai has understood.
3. **Practice** (`/practice`): two rounds of three problems, one at a time, two tries each, Rewatch for help, 10 minutes, then straight to the test.
4. **Final test** (`/exercises`, then `/results`): 10 multiple-choice questions graded on the server; the results show their explanations and the practice solutions.

**Lesson scope ("How strategies choose", 2026-10-08):** one goal G, "predict which option greedy, ε-greedy and UCB pick next and explain why greedy can lock in while ε-greedy and UCB keep exploring". `topic.yaml` → `lesson` holds the goal, the 9 nodes (n01, n03, n05, n06, n07, n08, n16, n11, n12), facts made optional here (n03.f2, n06.f2) and the video segments. `pnpm content bundle` builds `bundle.json` (what the app reads) from that slice: 13 facts Kai waits for, help timestamps clipped to the segments, and `outOfScopeTerms` (lexicon of the other nodes, e.g. "regret") that Kai may only use after the learner does. `graph.draft.json` (17 nodes, goals LG1–LG3 from the C2 document) stays the full source.

## App rules (do not break)

- **Secrets stay on the server.** `OPENROUTER_API_KEY`, `SESSION_SECRET`, `CODE_SECRET`, Upstash credentials, test and pretest answers and practice solutions are only read in `lib/server/*` (marked `server-only`) and API routes. Never `NEXT_PUBLIC_`. After a build, `.next/static` must contain no key, answer, solution or lesson fact text.
- **The browser never calls OpenRouter.** Only `/api/session`, `/api/chat`, `/api/practice`, `/api/grade` and `/api/log` exist. Each validates input with zod, caps sizes, checks the Origin, requires a signed session token (except `/api/session`), and is rate-limited (`lib/server/limit.ts`).
- **Limits are per learner first.** A lab room shares one IP, so per-IP caps stay generous (120 chat turns/min). Per-session caps do the real work (10/min, 45 per session), plus a site-wide daily cap. Only the checks that protect the model budget (chat per session, site-wide daily) and the once-per-session ones (session start, grading) go to Upstash; bursts, `/api/practice` and `/api/log` count in memory (`"local"` in `limitAll`): each shared check costs about 5 Redis commands.
- **No key means demo mode** (`config.demo`): an offline judge and writer, with a visible "Demo mode" badge. The whole flow must keep working without a key.
- **Kai's state lives in the browser** (localStorage) and is re-validated on every request (`engine/tutor/state.ts`). Tampering only affects that learner's own session.
- **Engine stays pure TypeScript** in `engine/tutor/` (no Next imports), so it can be unit-tested and reused by a CLI.
- **Kai's writer never sees lesson facts**, only the notebook (learner quotes and misconceptions), the move and the recent chat. Leak control is the term check in `engine/tutor/admit.ts` (one rewrite, then a fallback line).
- **Every judge verdict quotes the learner word for word.** Code drops verdicts and misconceptions whose quote isn't in the message (`findQuote`: exact up to case and punctuation, or ≥ 80% of ≥ 3 quote words in order and close together; the notebook stores the learner's matching span, never the judge's wording). The judge's JSON schema restricts ids to real facts and nodes (it once returned "n01.f1: <text>", which silently dropped every verdict). After changing the judge prompt or schema, run a few live calls (cents), not only demo mode.
- **Every Kai message ends with one concrete question** (except wrapUp).
- **Kai's mind only while teaching (and after the results).** `/mind` and `/teach` send the learner forward during practice and the test, so the conditions differ only in whose answers get feedback. It gives no hints: Kai's questions appear only once asked (or answered), with the learner's words; unasked ones are a count; never fact text.
- **Participants can't skip teaching at once.** "I've taught all I can" appears for participants after 12 messages or 8 minutes (`STOP_AFTER` in `Teach.tsx`), for team sessions from the start.
- **Log everything for the study** (`lib/server/events.ts`, `record()`; client events through `/api/log`, `track()` in `lib/client/log.ts`, batched every 15 s and sent at once on page change or tab hide). Server: session start (pid, condition, entry, device), the pretest (answers, score, "I don't know" count, `excluded`), every chat turn (message, reply and drafts, verdicts and misconceptions with quotes, dropped ones, intent, move, mood, leaks, progress, node states, readiness reason, elapsed and compose time, pasted characters, every model call with ms, tokens and cost), notebook snapshots (`notebook_snapshot`: server when Kai is ready, browser when the learner leaves teaching), practice tries (attempt, round, answer, working, time on the problem), Rewatch use, test answers, errors and rate-limit hits. Client: page views, tab switches, video play/pause/seek/rate/part ends, typing and pasting, help opens, Kai's mind use, practice problem show/leave/skip, test clicks. Store: Upstash list `docendo:events:v1` (required for the study), else `.data/events.jsonl` locally. Never IPs or access codes. `pnpm events export` → `data/export-*/` (events.jsonl, sessions.csv, turns.csv, practice.csv, test.csv, video.csv). `data/` and `.data/` are gitignored: they hold what learners wrote. When adding a feature, add its events and export columns.
- **Look:** see below. Light only. Designed, not templated.

## Kai's loop (engine/tutor)

`judge` (LLM, or mock) → `applyJudgement` (notebook, misconceptions, used terms, attempts, unparking) → `nextMove` (policy) → `applyMove` → `write` (LLM, or mock) → `forbiddenTerms` check → reply.

- Every required fact has an `ask`, Kai's novice question for it (ancestors' terms only). Moves: open (the idea's `probes.open`), followUp (the next missing fact's `ask`; asked once, or twice after a partial or wrong answer; "I don't know" skips on; an off-topic reply re-asks without using it up), nudge ("what's next?" before the idea is done: one "before we move on…", then park), deepen (one probe per explained idea), misconception (Kai voices the idea's common misconception as its own guess), contradict (a new wrong fact), answer (the learner asked Kai; carries the next question in `then`), wrapUp. `listen` stays in the enum only so old saved states parse. `closure` makes Kai say "got it" or "let's come back to it" before the next question. All questions used up → the idea is parked; a correct verdict on any of its facts unparks it.
- Policy order (`policy.ts`): wrap up if ready or at 30 messages → answer the learner's question → contradict a new wrong fact → move_on: nudge once, then park → focus explained: misconception, deepen, move on → next missing fact's question → park and move on. Next idea: 10 × unlocked + 3 × mentioned now + 2 × serves the least-covered goal + 1 × child of focus − 2 × parked; ties by graph order.
- The judge also returns `misconceptions`: any wrong belief, open-ended (no fixed list or ids), with the idea's node id, a verbatim quote and a one-line `belief` for the log only. `state.misconceptions` keeps the learner's words; Kai believes them.
- Intents: explain, answer, ask_kai, unsure, move_on, off_topic; only explain, answer and unsure count as an attempt (unlocks help).
- Ready (`readyReason`): ≥ 80% of the teachable required facts, or ≥ 50% once the learner has taught for 8 minutes; every goal needs an explained idea. Wrap-up after 30 learner messages regardless. Partial counts ½ and never overwrites a correct verdict.
- Moods per Kai message: great, okay, confused (`moodFor`), plus neutral and thinking in the UI. Kai's mind (`mind.ts`): statuses off, bonus, unseen, mentioned ("Started"), explained ("Done"), checked, parked ("Set aside"). Circles are facts; goals are shapes in violet, orange or teal, never red, yellow or green.

## Content

- Written by hand: `graph.draft.json` (nodes with `id`, `label`, `needs`, `goals`, `facts` with `required` and `ask`, `lexicon`, `misconception`, `probes`), `questions.json` (contradictions, fallbacks), `coverage.json` (which facts the learner videos state, with chunk ids; a deliberate gap gets `accepted`), `practice.json`, `exercises.json`, `pretest.json`.
- **Authoring pipeline, stashed** in `content/authoring/`: not part of the MVP flow, kept for building new topics later. `draft` (an LLM drafts the graph and questions), `locate` (BM25 candidates per fact → `locations.json`, kept; its top 3 held the right passage for 19 of 26 facts, better than a bge-small embedding at 16), `verify` (an LLM decides coverage), `review` (team review page), `freeze` (graph.json with a hash; `bundle` reads graph.json if present, else graph.draft.json). The reference sources in topic.yaml (ritvikmath's UCB video, Sutton & Barto and Slivkins PDFs) feed only these steps; their chunks are kept. The bandits content itself was written by hand.
- `pnpm content ingest` fetches every source in topic.yaml (YouTube captions through the player API as the Android client, or a `<sourceId>.vtt` in `sources/raw/`; PDF and web pages for the reference sources). `validate` checks structure and leak-safety: a probe's `open` and every `ask` may use only ancestors' lexicon terms; `why`/`whatIf`/`compute`, misconception lines and contradiction questions may also use the node's own terms; fallback lines none (`hasTerm` in `content/terms.ts`, also used by `admit`). `bundle` slices it for the app.
- Graph layout (`content/layout.ts`, Kai's mind): layered on a grid, long edges routed through lanes, crossings minimised; tests guard it.
- **Practice** (`practice.json`, `content/practice.ts`): six problems in two rounds (`round`), round 2 matching round 1 idea by idea (`idea`: greedy, epsilon, ucb) in new settings (food trucks; headlines and slot machines). Kinds `choice` ("pick and why": every option pairs a choice with a reason) or `number` (tolerance; "85%", "0,85" and "85" read as 0.85 for a probability). Every solution step lists the `facts` it uses (the hook for the recursive condition). `/api/practice` checks (at most `PRACTICE_TRIES`, default 2; a non-number doesn't use a try) and finds Rewatch moments (`lib/server/moments.ts`); `/api/grade` returns the solutions with the graded test. `minutes` (or `PRACTICE_MINUTES`) sets the timer, which survives reloads. Only ideas the videos teach: "the bonus grows with t" (n12.f2) is not in them.
- **Final test** (`exercises.json`): 10 MCQs in lesson order, by `section`. Rules: own settings (banner ads, coffee machines, a study app, podcasts; never restaurants, food trucks, slot machines or headlines), each makes sense alone, only what the videos cover, every wrong option a real confusion, no single random draws, one idea per item and no stem giving away another, small arithmetic, keys spread over positions. `tests/practice.test.ts` recomputes every numeric key.

## Commands

```
pnpm dev
pnpm build && pnpm start
pnpm test && pnpm typecheck
pnpm build && pnpm e2e           # browser walkthrough on its own safe server (demo Kai, no Upstash, port 3199); screenshots in .e2e/
pnpm e2e <url>                   # against a server you started (set it up the same way, or it spends credits and logs to Upstash)
pnpm chat [--demo]               # terminal chat with Kai, prints judge verdicts and moves (live without --demo if a key is set)
pnpm content ingest|validate|bundle bandits   # what the MVP uses
pnpm content draft|locate|verify|review|freeze|all bandits   # the stashed authoring pipeline (draft and verify need a key)
pnpm codes 40 [--base <url>]     # participant codes → data/codes-*.csv (needs CODE_SECRET); pnpm codes check <code>
pnpm events export|summary       # research data from Upstash (or --from a .jsonl)
```

## Deploy

Vercel, from GitHub; see README.md. Required: `SESSION_SECRET`; for the study `CODE_SECRET` and Upstash Redis (the research log). Optional: `OPENROUTER_API_KEY` (otherwise demo mode), `ACCESS_CODE`, `PRACTICE_MINUTES`, `PRACTICE_TRIES`, the limit and model overrides in `.env.example`. Env changes need a redeploy. Give the OpenRouter key a credit limit.

## Stack

TypeScript 5.9 (Next's build-time type check needs its JS API, so not TS 7), pnpm, zod, vitest, puppeteer-core for e2e. Next.js 16 (App Router, Turbopack) at the repo root: `app/` pages and API routes, `components/` client UI, `lib/server/` env, tokens, limits, content and events, `lib/client/` localStorage session and event batching, `lib/codes.ts` (shared with the script). LLMs through OpenRouter (`engine/llm.ts`) with pinned model ids per role (judge, writer; default `google/gemini-2.5-flash`), `data_collection: "deny"`, JSON schema for the judge, 25 s timeouts. Avoid native ML dependencies (no darwin-x64 builds on this Intel Mac). iCloud sync duplicates files as "name 2" in `.next` and `node_modules`, which breaks the typecheck: `rm -rf .next node_modules && pnpm install`. `<html>`/`<body>` have `suppressHydrationWarning` (browser extensions add attributes); nowhere else.

## Look (participant app)

Friendly chat bubbles, Bricolage Grotesque for names and headings, Figtree for body text, four arm-like step bars in the header (red, yellow, green, blue: Watch, Teach Kai, Practice, Test), Kai's faces in one flat style (same yellow), help as a video card with the real YouTube thumbnail, a timestamp badge and a red progress bar, motion only in "Kai is thinking". Icons from `lucide-react`. Light only. It must look designed, not AI-generated.
- **One header row** (`Header` in `components/ui.tsx`): brand and page tools left, step bars centred, status and demo badge right; on phones the step bars hide (an e2e check guards overlap).
- **Reading column** `--col: clamp(720px, 64vw, 1040px)`.
- **Few boxes:** no nested outlined rectangles; questions without cards, only option boxes; Kai's mind frames only the graph.
- Welcome page: three zones filling the screen. Ending teaching shows Kai's closing line in place; the learner moves on with a click. Learner messages up to 4,000 characters.

## Terminology and writing

- Say **condition** (direct / recursive feedback) or **option**. Never "arm" for a study condition; "arm" is only the bandit term.
- Kai = the tutee; learner = the human who teaches.
- No " · " separators in text, UI, titles, docs or console output (it reads as AI-generated); use ordinary punctuation. Few decorative symbols; prefer × in maths.
