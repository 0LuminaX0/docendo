// The text lesson's two formulas, as MathML (every current browser draws it, no maths library needed). The markup is
// fixed here, never built from data, so setting it as HTML is safe. A wide formula scrolls inside its own box on a phone.

const XBAR_I = "<msub><mover><mi>x</mi><mo>‾</mo></mover><mi>i</mi></msub>";

const MATHML: Record<string, { label: string; ml: string }> = {
  greedy: {
    label: "pick equals the option i with the highest average x bar i",
    ml: `<math display="block"><mtext>pick</mtext><mo>=</mo><mtext>the option&#xA0;</mtext><mi>i</mi><mtext>&#xA0;with the highest average&#xA0;</mtext>${XBAR_I}</math>`,
  },
  ucb: {
    label: "score i equals x bar i plus c times the square root of ln of t over n i",
    ml: `<math display="block"><msub><mtext>score</mtext><mi>i</mi></msub><mo>=</mo>${XBAR_I}<mo>+</mo><mi>c</mi><mspace width="0.17em"></mspace><msqrt><mfrac><mrow><mi>ln</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo></mrow><msub><mi>n</mi><mi>i</mi></msub></mfrac></msqrt></math>`,
  },
};

export function Formula({ id }: { id: string }) {
  const f = MATHML[id];
  if (!f) return null;
  return <div className="lesson-formula" role="img" aria-label={f.label} dangerouslySetInnerHTML={{ __html: f.ml }} />;
}
