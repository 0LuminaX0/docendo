# Docendo plan

Design history and research grounding: https://claude.ai/artifact/TFPVnezekaraxiz7VQtxoP · Graph review: https://claude.ai/artifact/MB6a5XmLjoZBJSmSiyubHm · Rules: [CLAUDE.md](CLAUDE.md) · Deploy: [README.md](README.md)

## Direction (2026-10-07)

Single-version MVP: watch → teach Kai until it feels ready → 10 exercises. The two-condition comparison is on hold (the TA judged the difference too small). The knowledge graph stays as Kai's internal structure.

## Done

- [x] Content pipeline: ingest (YouTube, PDF, web), locate, verify, validate, review, freeze, bundle
- [x] Bandits graph: 17 core + 2 branch nodes; coverage decisions; question bank (all hand-written, no API key yet)
- [x] Tutor engine (`engine/tutor`): judge with quote check, notebook, deterministic policy, writer, term-leak check with fallback; offline demo mode
- [x] Web app: welcome, watch (2 videos), teach chat (help card with video timestamps, Kai's moods, readiness meter), exercises (graded on the server), results
- [x] Security: server-only secrets, signed session tokens, Origin check, zod validation and size caps, per-learner/per-network/daily rate limits (Upstash or memory), CSP and security headers; build scanned for leaked answers and keys
- [x] Tests (49) + `pnpm e2e` browser walkthrough (demo mode, 10 checks: ready within 30 messages, all three reactions, Kai's mind, server grading, skip from the start, no sideways scroll at phone width)
- [x] 2026-10-07 round 2: Kai's faces per message (great / okay / confused + neutral, thinking), max 30 messages, "I've taught all I can" from the start, partial facts count ½ (never downgrade a correct one), "Kai's mind" view (toggle + `/mind`, live graph, goal progress, scoring explained, what you told Kai), video durations, retry on errors, auto-growing input, `pnpm chat` terminal tester, mood passed to the writer so words match the face

- [x] 2026-10-07 round 3 (after the first live test): one question per required fact (`ask`), follow-ups ask the next missing fact, "what's next?" gets one "before we move on…", ideas close with "got it" or "let's come back to it", every Kai message ends with a question; gibberish no longer parks ideas and a correct fact unparks one; fuzzy quote check; judge fact ids constrained by schema (the live judge's "id: text" answers had been dropping every verdict); Kai's mind lists asked questions with the learner's answers (unasked ones as a count only), bonus status, goal shapes instead of dots

- [x] 2026-10-08 round 4: study plan = replicate Okita & Schwartz (2013) Exp. 2 (recursive vs direct feedback). Practice chapter (step 3, base case = direct feedback): 8 timed problems, Check with a right/wrong light, Show solution, per-step fact links for the later "Kai solves it" condition; `/api/practice`. Final test is now step 4. Graph variants page (`/variants`) with 3 focused options, video cuts and fit to practice.

- [x] 2026-10-08 round 5: scope "How strategies choose" (one goal, 9 ideas, 13 facts, `lesson` in topic.yaml); lesson = 8:12 in three parts played as one video (YouTube IFrame API); readiness = 80%, or 50% after 8 min of teaching; practice rewritten for the scope with "pick and why" items and Rewatch hints; final test rewritten as parallel transfer items; research log (`lib/server/events.ts`, `/api/log`, `pnpm events export`)

## Next

- [ ] **Upstash Redis on Vercel** before any participant: it is where the research log lives
- [ ] Pilot with 2–3 people end to end on the real model; check the total time (target ≈ 35 min) and the export
- [ ] Recursive-feedback condition: Kai solves the practice problems from its notebook (steps from `practice.json`), right/wrong light, click a sentence to see the notebook statement behind it; equal access to correct solutions

- [ ] **Deploy**: GitHub repo → Vercel import → `SESSION_SECRET` → Upstash Redis → redeploy (README)
- [ ] **OpenRouter key** (now in `.env`) with a credit limit → test real Kai end to end in the browser; tune the judge prompt on real explanations
- [ ] Tutee name (placeholder: Kai)
- [x] Videos cut to ~15 min: ritvikmath part 1 + DataMListic (UCB, regret growth). 4 required facts remain outside the videos; Kai doesn't wait for them and the exercises don't test them
- [ ] Exercises reviewed by a team member who didn't write the prompts
- [ ] Optional: store session results (Neon Postgres) instead of Vercel logs only; pre-test before watching; LLM claim check in `admit`
