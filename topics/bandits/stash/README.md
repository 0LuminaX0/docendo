# Stashed content (not part of the app)

What the bandits study used before and no longer serves. The app never loads this folder (packs are imported file by file in `lib/server/topics.ts`), and `pnpm content validate` doesn't read it. To use something again, move it back into the pack's file in the folder above and run `pnpm content validate bandits`.

- `exercises.json`: test items taken out, with keys, rubrics, diagnoses and notes: the team's T1 to T10 and V1 to V10 (2026-11-02), Phil's T10, T11, T13 and T14, the optimistic start (T15) and its twin V12.
- `practice.json`: P1, P5 and P6, which need ε-greedy (left out of the lesson 2026-11-05).
- `pretest.json`: q3 (a statistics course, only recorded) and the harmonic-series item that was C2's h2.
- `script-*.json`: Kai's earlier fixed questions: the colleague's ten (2026-11-03, before the pilot), the seven built on the graph after the pilot, and the ten with ε-greedy and the comparison.
