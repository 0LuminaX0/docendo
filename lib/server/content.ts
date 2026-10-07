import "server-only";
import { z } from "zod";
import bundleJson from "../../topics/bandits/bundle.json";
import exercisesJson from "../../topics/bandits/exercises.json";
import { Bundle } from "../../content/schema";
import { BOX_H, BOX_W, layout, routePath } from "../../content/layout";

// The MVP serves one topic. To switch topics, point these imports at another
// topics/<slug>/ folder after running `pnpm content bundle <slug>`.

export const bundle: Bundle = Bundle.parse(bundleJson);

const Exercise = z.object({
  id: z.string(),
  goal: z.string(),
  type: z.string(),
  section: z.string(),
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0),
  explain: z.string(),
});
export const exercises = z.object({ title: z.string(), items: z.array(Exercise).min(1) }).parse(exercisesJson).items;

/** What the browser may see before grading: no answers, no explanations. */
export const publicExercises = exercises.map(({ id, section, prompt, options }) => ({ id, section, prompt, options }));
export type PublicExercise = (typeof publicExercises)[number];

/** Video list for the watch page and the help card. */
export const videos = bundle.videos.map((v, i) => ({ ...v, part: i + 1 }));

/**
 * The lesson graph's shape for the "Kai's mind" view: positions, labels and
 * prerequisites only. Fact text and Kai's questions stay on the server.
 */
export const graphView = (() => {
  const { pos, routes, width, height } = layout(bundle.nodes);
  return {
    nodes: bundle.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, needs: n.needs, goals: n.goals })),
    // SVG path per prerequisite edge, keyed "from>to"
    edges: Object.entries(routes).map(([key, pts]) => {
      const [from, to] = key.split(">") as [string, string];
      return { from, to, d: routePath(pts) };
    }),
    goals: bundle.goals.map((g) => ({ id: g.id, level: g.level, text: g.text })),
    pos,
    width,
    height,
    box: { w: BOX_W, h: BOX_H },
  };
})();
export type GraphView = typeof graphView;
