# Docendo

Learning-by-teaching study for CS-411 Digital Education (EPFL). Team: Andrii Negrub, Phil Gustke, Rafael Cruz. A learner watches a lesson on multi-armed bandits, teaches it to an AI classmate ("Kai", placeholder name) until Kai feels ready, then answers ten exercises. A web MVP of this flow is built (Next.js, deployable to Vercel).

Plan with diagrams and references: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP. Task checklist: [PLAN.md](PLAN.md).

## Current direction (2026-10-07)

The two-condition study (prompted vs managed Kai) is **on hold**: the TA said the difference is too small to show results. What exists now is a **single-version MVP** that runs start to finish on the web:

1. **Watch**: two videos, about 15 minutes in total, embedded (`/watch`).
2. **Teach Kai**: a chat that continues until Kai feels ready (`/teach`).
3. **Exercises**: 10 multiple-choice questions, graded on the server (`/exercises`, then `/results`).

The knowledge graph is kept as Kai's internal structure: it decides what Kai asks and when it is satisfied. It is no longer the experimental manipulation. The earlier two-condition rules (parity test, observer, fixed 20-minute window) are not in force for the MVP; don't build a second condition unless asked.

## App rules (do not break)

- **Secrets stay on the server.** `OPENROUTER_API_KEY`, `SESSION_SECRET`, Upstash credentials and exercise answers are only read in `lib/server/*` (marked `server-only`) and API routes. Never use `NEXT_PUBLIC_` for them. After a build, `.next/static` must contain no key, answer or lesson fact text.
- **The browser never calls OpenRouter.** Only `/api/session`, `/api/chat` and `/api/grade` exist. Each validates input with zod, caps sizes, checks the Origin, requires a signed session token (except `/api/session`), and is rate-limited (`lib/server/limit.ts`: Upstash when configured, in-memory otherwise).
- **Limits are per learner first.** A lab room shares one IP, so per-IP caps stay generous (120 chat turns/min). Per-session caps do the real work (10/min, 60 per session), plus a site-wide daily cap.
- **No key means demo mode** (`config.demo`): an offline judge and writer, with a visible "Demo mode" badge. The full flow must keep working without a key.
- **Kai's state lives in the browser** (localStorage) and is re-validated on every request (`engine/tutor/state.ts`). Tampering only affects that learner's own session.
- **Engine stays pure TypeScript** in `engine/tutor/` (no Next imports), so it can be unit-tested and reused by a CLI.
- **Kai's writer never sees lesson facts**, only the notebook (learner quotes), the move and the recent chat. Leak control is the term check in `engine/tutor/admit.ts` (one rewrite, then a fallback line). The LLM claim check is not in the MVP.
- **Every judge verdict quotes the learner word for word.** Code drops verdicts whose quote isn't in the message (`findQuote`: exact up to case and punctuation, or ≥ 80% of ≥ 3 quote words in order and close together; the notebook then stores the learner's matching span, never the judge's wording). The judge's JSON schema restricts `fact` to real ids (it used to return "n01.f1: <text>", which silently dropped every verdict).
- **Every Kai message ends with one concrete question** (except wrapUp), so the learner always knows what Kai wants next. No passive "go on" moves.
- **Kai's mind gives no hints.** It shows Kai's questions only once Kai has asked them (or the learner answered them), with the learner's words; unasked questions are a count only. Never fact text.
- **Look:** direction 3 refined (see below). Light only. Keep it designed, not templated.

## Kai's loop (engine/tutor)

`judge` (LLM, or mock) → `applyJudgement` (notebook, used terms, attempts, unparking) → `nextMove` (policy) → `applyMove` → `write` (LLM, or mock) → `forbiddenTerms` check → reply. Every required fact has an `ask`: Kai's novice question for it (validated like `probes.open`: ancestors' terms only). Moves: open (the idea's `probes.open`), followUp (the `ask` of the next missing fact; each asked once, or twice after a partial/wrong answer; "I don't know" skips to the next; an off-topic reply re-asks the same question without using it up), nudge ("what's next?" before the idea is done: one "before we move on…", then park), deepen (one probe per explained idea), misconception, contradict, answer (learner asked Kai; carries the next question in `then`), wrapUp. `listen` stays in the enum only so old saved states parse. `closure` on a move makes Kai say "got it" (idea just explained) or "let's come back to it" (parked) before the next question. All questions used up → the idea is parked; a correct verdict on any of its facts unparks it; reopening resets its tries. Judge intents: explain, answer, ask_kai, unsure, move_on, off_topic; only explain/answer/unsure count as an attempt (unlocks help). Kai is ready when ≥ 80% of *teachable* required facts (covered by the videos, per `coverage.json`) are explained correctly and every goal has an explained idea. It wraps up regardless after 30 learner messages. Partial verdicts count ½ toward the score; a partial never overwrites an earlier correct verdict. "I've taught all I can" is visible from the first message (for testing). Moods per Kai message: great / okay / confused (from `moodFor`), plus neutral and thinking in the UI. `engine/tutor/mind.ts` builds the "Kai's mind" view model (ids, statuses, counts, asked questions with the learner's words, the current question; never fact text), shown in the teach page toggle and at `/mind`. Statuses: off, bonus (not in the videos but the learner explained some of it; doesn't count), unseen, mentioned ("Started"), explained ("Done"), checked, parked ("Set aside", with the open questions listed). In the graph, circles are facts only; learning goals are shapes (triangle, square, diamond) in violet/orange/teal, never red/yellow/green.

## Deploy

Vercel, from a GitHub repository; see README.md. Required env: `SESSION_SECRET`. Optional: `OPENROUTER_API_KEY` (otherwise demo mode), `ACCESS_CODE`, Upstash Redis (shared rate limits), the limit and model overrides in `.env.example`. Give the OpenRouter key a credit limit as the final backstop.

## Commands

```
pnpm content ingest bandits      # sources in topic.yaml → topics/bandits/sources/chunks/*.json (raw downloads cached, gitignored)
pnpm content draft bandits       # LLM drafts graph + questions (needs OPENROUTER_API_KEY; never overwrites without --force)
pnpm content locate bandits      # BM25 candidates per fact → locations.json
pnpm content verify bandits      # LLM decides coverage → coverage.json (keeps existing decisions unless --force)
pnpm content validate bandits    # structure, leak-safety of questions, coverage; --strict turns warnings into errors
pnpm content review bandits      # topics/bandits/review.html (team review page)
pnpm content freeze bandits      # strict validate, then graph.json with hash + help locations
pnpm content all bandits         # ingest, locate, verify (if key), validate, review
pnpm content bundle bandits      # graph + coverage + questions → bundle.json (what the web app reads)
pnpm dev · pnpm build · pnpm start
pnpm chat [--demo]               # terminal chat with Kai, prints judge verdicts and moves
pnpm e2e [url]                   # browser walkthrough (puppeteer-core + installed Chrome), screenshots in .e2e/
                                 # .env has a real key: start the server with DOCENDO_DEMO=1 (or OPENROUTER_API_KEY=) or the run spends credits
pnpm test · pnpm typecheck
```

## Content pipeline rules

- `locate` only proposes candidates; it never decides coverage. Measured on the bandits transcripts: BM25 (fact + node label + terms) had the right passage in its top 3 for 19 of 26 facts; a bge-small embedding model did worse (16), so there is no embedding dependency. Coverage decisions live in `coverage.json` and come from `verify` or a person (`decidedBy` says which). A deliberate gap gets `accepted: "<reason>"`.
- Leak-safety of authored text is checked deterministically. A probe's `open` question may use only its ancestors' lexicon terms. `why`/`whatIf`/`compute`, misconception lines and contradiction questions may also use the node's own terms. Fallback lines may use no terms at all. The same `hasTerm` matcher (`content/terms.ts`) is meant for `admit`'s term stage.
- The current bandits graph and `coverage.json` were written by hand (by Claude, from the transcripts), because no API key existed yet. Re-running `draft` writes `graph.draft.llm.json` next to it for comparison.
- YouTube captions are fetched through the player API as the Android client. If that breaks, put a `<sourceId>.vtt` file in `sources/raw/`.
- Graph layout (`content/layout.ts`, used by Kai's mind and review.html): layered/Sugiyama on a grid. Columns = longest prerequisite chain; long edges get waypoints in every column they cross (lanes on half rows, never through boxes); row order = median sweeps + adjacent swaps keeping the fewest crossings; boxes snap to whole rows. Bandits graph: 1 crossing, 0 edges through boxes (was 6 and 6). Tests guard all of this.
- Hydration: `<html>`/`<body>` have `suppressHydrationWarning` because browser extensions (Grammarly) add attributes before React hydrates. Don't add it anywhere else.
- Intel Mac note: onnxruntime-node ≥ 1.23 has no darwin-x64 build. Avoid native ML dependencies.

## Knowledge graph

- Topic-agnostic. The engine reads only `topics/<slug>/graph.json` (frozen, hashed; each session stores the hash). It is produced by the steps above.
- Bandits: 17 core nodes (n01–n14 as agreed, plus n15 zero regret, n16 few samples, n17 when each strategy wins), budget 14–20, plus branch nodes b1 Thompson and b2 drifting rewards. Goals LG1–LG3 come from the C2 document.
- Learner videos (2026-10-07, ~15 min total as the user asked): ritvikmath e3L4VocZnnQ (11:43; setup, regret, greedy, ε-greedy, zero regret) + DataMListic 8CquWcViBfg (3:19; UCB, linear vs logarithmic regret). The old ritvikmath UCB video (FgmMK6RPU1c) is now a reference source. 20 teachable required facts; 4 required facts are not in the videos (n12.f2 growth of ln t, n14.f1/f2 assumptions, n17.f3 many arms vs few rounds). No single ≤15-min video covered regret and UCB together (Academic Gamer bkw6hWvh_3k lacks regret).
- A node has: `id`, `label`, `needs` (prerequisites), `goals`, `facts` (2–4, some `required`), `lexicon` (terms Kai may not use before the node is taught), `misconception`, `probes` {why, whatIf, compute}, `source` locators.
- Node states: unseen → mentioned → explained (required facts correct) → checked (probe asked); parked once all its questions are used up; a correct fact unparks it. Wrong facts stay in Kai's notebook as taught.
- Policy priorities (`engine/tutor/policy.ts`): wrap up if ready or at 30 messages → answer the learner's question, then carry on → contradict a new wrong fact → move_on: nudge once, then park → focus explained: misconception, deepen, move on → next missing fact's question → park and move on. Next idea score: 10·unlocked + 3·mentioned now + 2·serves least-covered goal + 1·child of focus − 2·parked; ties by graph order.

## Exercises

`topics/bandits/exercises.json`: 10 MCQs in lesson order, grouped by `section`. Every question must make sense on its own (no "in the restaurant example"), only test what the learner-facing videos cover, and keep its answer on the server.

## Terminology

- Say **condition** (prompted / managed) or **option**. Never "arm" for a study condition. "Arm" is only the bandit term in lesson content.
- The base case is "prompted", not "performed" (renamed in plan v3).
- Kai = the tutee; learner = the human who teaches; observer = the measuring instrument; module = a `Knowledge` implementation.

## Stack

TypeScript (5.9; Next's build-time type check needs its JS API, so not TS 7), pnpm, zod, vitest. Next.js 16 (App Router, Turbopack) at the repo root: `app/` pages and API routes, `components/` client UI, `lib/server/` env, tokens, limits and content, `lib/client/store.ts` localStorage session. LLMs go through OpenRouter (`engine/llm.ts`) with pinned model IDs per role (judge, writer; default `google/gemini-2.5-flash`), `data_collection: "deny"`, JSON schema for the judge, and 25 s timeouts. Content pipeline CLI: `content/` via tsx. Free tier: 20 req/min, 50/day (1,000/day after $10 of credit), checked 2026-10-06.

## Look (participant app)

Direction 3 from the plan, refined: friendly chat bubbles, Bricolage Grotesque for names and headings, Figtree for body text, a three-bar bandit-arm phase indicator in the header (Watch, Teach Kai, Exercises), Kai avatar with three expressions, help shown as a video-frame card with a timestamp, and motion only in the "Kai is thinking" indicator. Light-only for the study. The user wants it to look designed, not AI-generated: avoid generic templates. Icons come from `lucide-react` (send = round arrow button, Chat = message bubble, Kai's mind = brain). Kai's faces share one flat style (same yellow, no cheeks or colour changes). Video cards use the real YouTube thumbnail (`i.ytimg.com`, allowed by the CSP) with a timestamp badge and a red progress bar at the moment's position. README screenshots in `docs/` come from `pnpm e2e` (.e2e/ → docs/).

## Source documents

The design PDFs (C2 draft, background, study design options) are not in the repo. Key facts from them are in this file and the plan artifact. Learning goals: LG1 compute the regret of greedy and ε-greedy; LG2 compare ε-greedy and UCB1 by how they explore; LG3 model a new problem as a bandit and choose a strategy.
