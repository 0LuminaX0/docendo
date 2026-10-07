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
- [x] Tests (34) + `pnpm e2e` browser walkthrough (demo mode, 10 checks: ready within 30 messages, all three reactions, Kai's mind, server grading, skip from the start, no sideways scroll at phone width)
- [x] 2026-10-07 round 2: Kai's faces per message (great / okay / confused + neutral, thinking), max 30 messages, "I've taught all I can" from the start, partial facts count ½ (never downgrade a correct one), "Kai's mind" view (toggle + `/mind`, live graph, goal progress, scoring explained, what you told Kai), video durations, retry on errors, auto-growing input, `pnpm chat` terminal tester, mood passed to the writer so words match the face

## Next

- [ ] **Deploy**: GitHub repo → Vercel import → `SESSION_SECRET` → Upstash Redis → redeploy (README)
- [ ] **OpenRouter key** with a credit limit → set `OPENROUTER_API_KEY` → test real Kai end to end; tune the judge prompt on real explanations
- [ ] Tutee name (placeholder: Kai)
- [x] Videos cut to ~15 min: ritvikmath part 1 + DataMListic (UCB, regret growth). 4 required facts remain outside the videos; Kai doesn't wait for them and the exercises don't test them
- [ ] Exercises reviewed by a team member who didn't write the prompts
- [ ] Optional: store session results (Neon Postgres) instead of Vercel logs only; pre-test before watching; LLM claim check in `admit`
