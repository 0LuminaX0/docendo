// pnpm content <step> <topic> [--source <id>] [--strict]
// The MVP uses ingest, validate and bundle. draft, locate, verify, review and freeze are the
// authoring pipeline (content/authoring/): kept for building new topics later, not part of the
// study's flow. The bandits content was written by hand; locations.json is a kept output of locate.
//   ingest    sources → sources/chunks/*.json
//   draft     chunks + goals → graph.draft.json and questions.json (needs OPENROUTER_API_KEY)
//   locate    graph facts → candidate places in every source → locations.json
//   verify    decide which facts the learner-facing source states → coverage.json (needs OPENROUTER_API_KEY)
//   validate  check graph, questions and locations; exits 1 on errors
//   review    write review.html for the team
//   freeze    strict validate, then graph.json with a content hash
//   bundle    graph (frozen if present, else draft) + coverage + questions → bundle.json for the web app
//   all       ingest, locate, verify (if a key is set), validate, review

import { loadTopic } from "./paths";

const [step, slug, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const option = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (!step || !slug) {
  console.error("usage: pnpm content <ingest|draft|locate|verify|validate|review|freeze|bundle|all> <topic> [--source id] [--strict] [--force]");
  process.exit(2);
}

process.on("uncaughtException", (e) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

const topic = await loadTopic(slug);

async function ingest() {
  const { ingestSource } = await import("./ingest/index");
  const only = option("source");
  for (const source of topic.sources) {
    if (only && source.id !== only) continue;
    const file = await ingestSource(topic, source);
    console.log(`ingest  ${source.id.padEnd(14)} ${String(file.chunks.length).padStart(4)} chunks  ← ${file.origin}`);
  }
}

async function locate() {
  const { runLocate } = await import("./authoring/locate");
  await runLocate(topic);
}

async function verify() {
  const { runVerify } = await import("./authoring/verify");
  await runVerify(topic, { force: flag("force") });
}

async function validate(strict: boolean) {
  const { runValidate } = await import("./validate");
  const ok = await runValidate(topic, { strict });
  if (!ok) process.exitCode = 1;
  return ok;
}

async function review() {
  const { runReview } = await import("./authoring/review");
  await runReview(topic);
}

switch (step) {
  case "ingest":
    await ingest();
    break;
  case "draft": {
    const { runDraft } = await import("./authoring/draft");
    await runDraft(topic, { force: flag("force") });
    break;
  }
  case "locate":
    await locate();
    break;
  case "verify":
    await verify();
    break;
  case "validate":
    await validate(flag("strict"));
    break;
  case "review":
    await review();
    break;
  case "freeze": {
    const { runFreeze } = await import("./authoring/freeze");
    if (await validate(true)) await runFreeze(topic);
    break;
  }
  case "bundle": {
    const { runBundle } = await import("./bundle");
    await runBundle(topic);
    break;
  }
  case "all": {
    await ingest();
    await locate();
    const { hasApiKey } = await import("../engine/llm");
    if (hasApiKey()) await verify();
    else console.log("verify  skipped: no OPENROUTER_API_KEY (coverage.json is kept as it is)");
    await validate(false);
    await review();
    break;
  }
  default:
    console.error(`unknown step: ${step}`);
    process.exit(2);
}
