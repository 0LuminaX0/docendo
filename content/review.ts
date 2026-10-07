import { writeFile } from "node:fs/promises";
import { Coverage, Graph, Locations, Questions, type Node, type Topic } from "./schema";
import { existsSync, readJson, topicPaths } from "./paths";
import { checkGraph } from "./validate";
import { graphHash } from "./hash";
import { formatLoc } from "./format";

// review.html: one self-contained page for the team review. The graph is laid
// out from the file (columns = longest prerequisite chain, rows ordered to
// reduce crossings), so it always matches graph.draft.json.

import { BOX_H, BOX_W, layout, routePath } from "./layout";
export { layout };

export async function runReview(topic: Topic) {
  const p = topicPaths(topic.slug);
  const graph = await readJson(p.graphDraft, Graph);
  const questions = existsSync(p.questions) ? await readJson(p.questions, Questions) : undefined;
  const locations = existsSync(p.locations) ? await readJson(p.locations, Locations) : undefined;
  const coverage = existsSync(p.coverage) ? await readJson(p.coverage, Coverage) : undefined;
  const issues = checkGraph(topic, graph, { questions, locations, coverage });

  // per fact: up to 2 learner places and 2 reference places, pre-formatted
  const places: Record<string, { sourceId: string; role: string; label: string; href: string; snippet: string }[]> = {};
  const href = (sourceId: string, loc: { kind: string; start?: number; page?: number }) => {
    const s = topic.sources.find((x) => x.id === sourceId);
    if (!s) return "";
    if (s.kind === "youtube" && loc.kind === "time") return `https://www.youtube.com/watch?v=${s.videoId}&t=${Math.floor(loc.start ?? 0)}s`;
    if (s.kind === "pdf" && loc.kind === "page") return `${s.url}#page=${(loc.page ?? 0) - s.pageOffset}`;
    return s.kind === "web" ? s.url : "";
  };
  for (const [fact, locs] of Object.entries(locations?.facts ?? {})) {
    const pick = [...locs.filter((l) => l.role === "learner").slice(0, 2), ...locs.filter((l) => l.role === "reference").slice(0, 2)];
    places[fact] = pick.map((l) => ({ sourceId: l.sourceId, role: l.role, label: formatLoc(l.loc), href: href(l.sourceId, l.loc), snippet: l.snippet }));
  }
  // chunk ids in coverage decisions → labels
  const whereLabels: Record<string, { label: string; href: string }> = {};
  for (const locs of Object.values(locations?.facts ?? {}))
    for (const l of locs) whereLabels[l.chunkId] = { label: `${l.sourceId} ${formatLoc(l.loc)}`, href: href(l.sourceId, l.loc) };
  for (const d of Object.values(coverage?.facts ?? {}))
    for (const w of d.where)
      if (!whereLabels[w]) whereLabels[w] = { label: w, href: "" };

  const data = {
    topic: { slug: topic.slug, title: topic.title, goals: topic.goals, sources: topic.sources.map((s) => ({ id: s.id, title: s.title, role: s.role })) },
    graph,
    hash: graphHash(graph),
    questions: questions ?? null,
    coverage: coverage ?? null,
    places,
    whereLabels,
    issues,
    layout: layout(graph.nodes),
    paths: Object.fromEntries(Object.entries(layout(graph.nodes).routes).map(([k, pts]) => [k, routePath(pts)])),
    box: { w: BOX_W, h: BOX_H },
    builtAt: new Date().toISOString(),
  };
  await writeFile(p.review, page(data));
  console.log(`review  ${p.review}`);
}

const page = (data: unknown) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${body(data)}`;

// The part after <head> is also what gets published as an artifact.
export const body = (data: unknown) => `<title>Docendo Graph Review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --paper:#FFFFFF; --sunk:#F5F6F8; --surface:#FFFFFF; --ink:#1B1F27; --ink-2:#4B5261; --muted:#6E7582; --rule:#E4E7EC;
  --accent:#2D7DD2; --accent-soft:#EAF2FB; --lg1:#E5484D; --lg2:#E9A400; --lg3:#2E9E62;
  --ok:#2E9E62; --ok-soft:#E4F4EA; --part:#B7791F; --part-soft:#FBF0D9; --gap:#C9372C; --gap-soft:#FBE7E5;
  --f-display:"Bricolage Grotesque","Avenir Next","Segoe UI",sans-serif; --f-body:"Figtree","Segoe UI","Helvetica Neue",Arial,sans-serif; --f-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --paper:#111318; --sunk:#171A20; --surface:#1B1F27; --ink:#ECEEF2; --ink-2:#BFC5CF; --muted:#8E95A1; --rule:#2B303A;
  --accent:#5DA3EE; --accent-soft:#16263A; --lg1:#F2716A; --lg2:#F5C451; --lg3:#4CC285;
  --ok:#4CC285; --ok-soft:#14291D; --part:#E7B25E; --part-soft:#2D2412; --gap:#F2716A; --gap-soft:#33191A; color-scheme:dark }}
:root[data-theme="dark"]{
  --paper:#111318; --sunk:#171A20; --surface:#1B1F27; --ink:#ECEEF2; --ink-2:#BFC5CF; --muted:#8E95A1; --rule:#2B303A;
  --accent:#5DA3EE; --accent-soft:#16263A; --lg1:#F2716A; --lg2:#F5C451; --lg3:#4CC285;
  --ok:#4CC285; --ok-soft:#14291D; --part:#E7B25E; --part-soft:#2D2412; --gap:#F2716A; --gap-soft:#33191A; color-scheme:dark }
*{box-sizing:border-box}
body{margin:0; background:var(--paper); color:var(--ink); font:400 15px/1.55 var(--f-body); padding-inline:20px; -webkit-font-smoothing:antialiased}
.wrap{max-width:1280px; margin:0 auto; padding-block:36px 72px; display:flex; flex-direction:column; gap:28px}
h1,h2,h3{font-family:var(--f-display); margin:0; letter-spacing:-.02em; text-wrap:balance}
h1{font-size:clamp(1.8rem,4vw,2.4rem); line-height:1.1}
h2{font-size:1.25rem} h3{font-size:1.05rem}
p{margin:0}
code,.mono{font-family:var(--f-mono); font-size:.85em}
.meta{font:400 .8rem var(--f-mono); color:var(--muted); display:flex; flex-wrap:wrap; gap:6px 18px}
.tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px}
.tile{background:var(--sunk); border-radius:14px; padding:14px 16px; display:flex; flex-direction:column; gap:2px}
.tile b{font:700 1.5rem var(--f-display); font-variant-numeric:tabular-nums}
.tile span{font-size:.85rem; color:var(--ink-2)}
.bar{display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; justify-content:space-between}
.chips{display:flex; flex-wrap:wrap; gap:6px}
.chip{font:500 .82rem var(--f-body); border:1px solid var(--rule); background:var(--surface); color:var(--ink-2); padding:5px 11px; border-radius:99px; cursor:pointer; display:inline-flex; align-items:center; gap:7px}
.chip[aria-pressed="true"]{background:var(--ink); color:var(--paper); border-color:var(--ink)}
.chip:focus-visible,.gn:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.dot{width:9px; height:9px; border-radius:50%; display:inline-block; flex:none}
.wrap > *{min-width:0}
.legend{display:flex; flex-wrap:wrap; gap:6px 16px; font-size:.82rem; color:var(--ink-2)}
.legend span{display:inline-flex; gap:6px; align-items:center}
.sw{width:14px; height:10px; border-radius:3px; display:inline-block}
.main{display:flex; flex-direction:column; gap:20px; min-width:0}
.canvas{overflow:auto; background:var(--sunk); border-radius:16px; padding:8px; min-width:0; max-width:100%}
svg{display:block}
.edge{fill:none; stroke:var(--muted); stroke-width:1.2; opacity:.6}
.edge.br{stroke-dasharray:3 4}
.edge.hot{stroke:var(--accent); opacity:1; stroke-width:1.8}
.gn{cursor:pointer}
.gn rect.b{fill:var(--surface); stroke:var(--rule); stroke-width:1.2}
.gn.branch rect.b{stroke-dasharray:3 3}
.gn .id{font:500 10.5px var(--f-mono); fill:var(--muted)}
.gn .lb{font:600 12.5px var(--f-body); fill:var(--ink)}
.gn .st{stroke:none}
.gn.sel rect.b{stroke:var(--accent); stroke-width:2.4}
.gn.dim{opacity:.25}
.st.ok{fill:var(--ok)} .st.part{fill:var(--part)} .st.gap{fill:var(--gap)} .st.undecided{fill:var(--rule)}
.c-LG1{fill:var(--lg1)} .c-LG2{fill:var(--lg2)} .c-LG3{fill:var(--lg3)}
.panel{background:var(--surface); border:1px solid var(--rule); border-radius:16px; padding:22px 24px; display:grid; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:20px 36px; min-width:0; scroll-margin-top:16px}
.panel > .head{grid-column:1 / -1}
.panel .col{display:flex; flex-direction:column; gap:16px; min-width:0}
@media (max-width:860px){ .panel{grid-template-columns:minmax(0,1fr)} }
.panel .head{display:flex; flex-direction:column; gap:4px}
.kick{font:500 .72rem var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--muted)}
.facts{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px}
.fact{display:flex; flex-direction:column; gap:6px}
.fact .t{display:flex; gap:8px; align-items:baseline}
.fact .t code{color:var(--accent); flex:none}
.tag{font:500 .7rem var(--f-mono); padding:2px 7px; border-radius:99px; white-space:nowrap}
.tag.req{background:var(--accent-soft); color:var(--accent)}
.tag.ok{background:var(--ok-soft); color:var(--ok)} .tag.part{background:var(--part-soft); color:var(--part)} .tag.gap{background:var(--gap-soft); color:var(--gap)} .tag.undecided{background:var(--sunk); color:var(--muted)}
.places{display:flex; flex-direction:column; gap:4px; margin-left:4px; padding-left:10px; border-left:2px solid var(--rule)}
.place{font-size:.82rem; color:var(--ink-2)}
.place a{color:var(--accent); font-family:var(--f-mono); font-size:.78rem; text-decoration:none}
.place a:hover{text-decoration:underline}
.place .sn{display:block; color:var(--muted); font-style:italic}
.note{font-size:.82rem; color:var(--ink-2)}
.terms{display:flex; flex-wrap:wrap; gap:5px}
.terms span{font:400 .78rem var(--f-mono); background:var(--sunk); padding:2px 8px; border-radius:6px}
dl{margin:0; display:grid; grid-template-columns:82px minmax(0,1fr); gap:6px 12px; font-size:.9rem}
dt{font:500 .72rem/1.9 var(--f-mono); color:var(--muted); text-transform:uppercase; letter-spacing:.06em}
dd{margin:0}
.mis{background:var(--part-soft); border-radius:10px; padding:10px 12px; font-size:.9rem; display:flex; flex-direction:column; gap:4px}
.issues{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; font-size:.85rem}
.issues li{display:grid; grid-template-columns:54px 70px minmax(0,1fr); gap:8px}
.issues .lv{font:500 .72rem var(--f-mono); text-transform:uppercase}
.issues .lv.error{color:var(--gap)} .issues .lv.warn{color:var(--part)}
.issues code{color:var(--ink-2)}
details{background:var(--sunk); border-radius:14px; padding:12px 16px}
details.cand{background:none; padding:0; font-size:.82rem; color:var(--muted)}
details.cand summary{font-weight:500}
details.cand[open] summary{margin-bottom:6px}
details summary{cursor:pointer; font-weight:600}
details[open] summary{margin-bottom:10px}
.qs{display:flex; flex-direction:column; gap:10px; font-size:.9rem}
.qs b{font-weight:600}
.empty{color:var(--muted); font-size:.9rem}
</style>
<div class="wrap">
  <header style="display:flex;flex-direction:column;gap:12px">
    <div class="meta" id="meta"></div>
    <h1 id="title">Lesson graph review</h1>
    <p style="color:var(--ink-2);max-width:72ch">Click a node to see its facts, where the learner-facing source covers them, Kai's questions and the terms Kai may not use before the idea is taught. The left stripe on each node shows whether its required facts are in the learner-facing source.</p>
  </header>
  <section class="tiles" id="tiles"></section>
  <div class="bar">
    <div class="chips" id="goals" role="group" aria-label="Highlight a goal"></div>
    <div class="legend">
      <span><i class="sw" style="background:var(--ok)"></i>covered</span>
      <span><i class="sw" style="background:var(--part)"></i>partly</span>
      <span><i class="sw" style="background:var(--gap)"></i>missing from learner source</span>
      <span><i class="sw" style="background:var(--rule)"></i>not decided</span>
    </div>
  </div>
  <div class="main">
    <div class="canvas"><svg id="g" role="img" aria-label="Lesson graph"></svg></div>
    <aside class="panel" id="panel" aria-live="polite"></aside>
  </div>
  <details id="issuesBox"><summary id="issuesSum">Validator</summary><ul class="issues" id="issues"></ul></details>
  <details><summary>Question bank</summary><div class="qs" id="qs"></div></details>
</div>
<script>
const D = ${JSON.stringify(data).replace(/</g, "\\u003c")};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nodes = D.graph.nodes, byId = new Map(nodes.map((n) => [n.id, n]));
const cov = (fid) => D.coverage && D.coverage.facts[fid];
const covClass = (d) => !d ? "undecided" : d.status === "covered" ? "ok" : d.status === "partial" ? "part" : d.accepted ? "part" : "gap";
function nodeStatus(n) {
  const req = n.facts.filter((f) => f.required).map((f) => cov(f.id));
  if (n.kind === "branch") return "undecided";
  if (req.some((d) => !d)) return "undecided";
  if (req.some((d) => d.status === "absent" && !d.accepted)) return "gap";
  if (req.some((d) => d.status !== "covered")) return "part";
  return "ok";
}

$("meta").innerHTML = [D.topic.title, "draft " + esc(D.graph.draftedAt), "hash " + D.hash, "drafted by " + esc(D.graph.draftedBy.split(" from ")[0]), "page built " + D.builtAt.slice(0, 16).replace("T", " ")].map((x) => "<span>" + x + "</span>").join("");
$("title").textContent = D.topic.title + ": lesson graph review";

const core = nodes.filter((n) => n.kind === "core");
const req = core.flatMap((n) => n.facts.filter((f) => f.required));
const reqCovered = req.filter((f) => cov(f.id) && cov(f.id).status === "covered").length;
const reqAbsent = req.filter((f) => cov(f.id) && cov(f.id).status === "absent").length;
const errors = D.issues.filter((i) => i.level === "error").length, warns = D.issues.length - errors;
$("tiles").innerHTML = [
  [core.length + " + " + (nodes.length - core.length), "core + branch nodes"],
  [nodes.reduce((a, n) => a + n.facts.length, 0), "facts, " + req.length + " required"],
  [D.coverage ? reqCovered + "/" + req.length : "—", "required facts covered by the learner source"],
  [D.coverage ? reqAbsent : "—", "required facts missing from it"],
  [errors + " / " + warns, "validator errors / warnings"],
].map(([b, s]) => '<div class="tile"><b>' + b + "</b><span>" + s + "</span></div>").join("");

// goals
let goal = null;
$("goals").innerHTML = D.topic.goals.map((g) => '<button type="button" class="chip" aria-pressed="false" data-g="' + g.id + '"><i class="dot" style="background:var(--' + g.id.toLowerCase() + ')"></i>' + g.id + " " + esc(g.level) + "</button>").join("");
$("goals").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  goal = goal === b.dataset.g ? null : b.dataset.g;
  document.querySelectorAll("#goals .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.g === goal)));
  draw();
});

// graph
const W = D.box.w, H = D.box.h, P = D.layout.pos;
let sel = /^(n\\d{2}|b\\d)$/.test(location.hash.slice(1)) ? location.hash.slice(1) : null;
function draw() {
  const svg = $("g");
  svg.setAttribute("viewBox", "0 0 " + D.layout.width + " " + D.layout.height);
  svg.setAttribute("width", D.layout.width); svg.setAttribute("height", D.layout.height);
  let s = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 z" style="fill:var(--muted)"/></marker><marker id="ahh" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 z" style="fill:var(--accent)"/></marker></defs><g>';
  for (const n of nodes) for (const need of n.needs) {
    const d = D.paths[need + ">" + n.id]; if (!d) continue;
    const hot = sel && (sel === n.id || sel === need);
    s += '<path class="edge' + (n.kind === "branch" ? " br" : "") + (hot ? " hot" : "") + '" marker-end="url(#' + (hot ? "ahh" : "ah") + ')" d="' + d + '"/>';
  }
  s += "</g>";
  for (const n of nodes) {
    const p = P[n.id], st = nodeStatus(n), dim = goal && !n.goals.includes(goal);
    s += '<g class="gn ' + n.kind + (sel === n.id ? " sel" : "") + (dim ? " dim" : "") + '" data-n="' + n.id + '" tabindex="0" role="button" aria-label="' + n.id + " " + esc(n.label) + '" transform="translate(' + p.x + "," + p.y + ')">';
    s += '<rect class="b" width="' + W + '" height="' + H + '" rx="10"/>';
    s += '<rect class="st ' + st + '" x="0" y="8" width="4" height="' + (H - 16) + '" rx="2"/>';
    s += '<text class="id" x="12" y="17">' + n.id + (n.kind === "branch" ? " · branch" : "") + "</text>";
    s += '<text class="lb" x="12" y="34">' + esc(n.label) + "</text>";
    n.goals.forEach((g, i) => { s += '<circle class="c-' + g + '" cx="' + (W - 12 - (n.goals.length - 1 - i) * 11) + '" cy="13" r="4"/>'; });
    s += "</g>";
  }
  svg.innerHTML = s;
}
$("g").addEventListener("click", (e) => { const g = e.target.closest(".gn"); if (g) select(g.dataset.n); });
$("g").addEventListener("keydown", (e) => { const g = e.target.closest(".gn"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(g.dataset.n); } });

function select(id) { sel = id; try { history.replaceState(null, "", "#" + id); } catch (e) {} draw(); panel(); const r = $("panel").getBoundingClientRect(); if (r.top > innerHeight * 0.75) $("panel").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }

const statusText = { ok: "covered", part: "partly", gap: "missing", undecided: "not decided" };
function panel() {
  const n = byId.get(sel);
  if (!n) { $("panel").innerHTML = '<p class="empty">Select a node to see its details.</p>'; return; }
  const issues = D.issues.filter((i) => i.where === n.id || i.where.startsWith(n.id + "."));
  const contra = D.questions && n.misconception ? D.questions.contradictions.find((c) => c.misconception === n.misconception.id) : null;
  let h = '<div class="head"><span class="kick">' + n.id + " · " + n.kind + (n.goals.length ? " · " + n.goals.join(", ") : "") + '</span><h2>' + esc(n.label) + "</h2>";
  h += '<p class="note">Needs: ' + (n.needs.length ? n.needs.map((x) => '<a href="#' + x + '" data-go="' + x + '">' + x + " " + esc(byId.get(x)?.label) + "</a>").join(", ") : "nothing (a starting point)") + "</p></div>";
  h += '<div class="col"><span class="kick">Facts</span><ul class="facts">';
  for (const f of n.facts) {
    const d = cov(f.id), c = covClass(d);
    h += '<li class="fact"><div class="t"><code>' + f.id.split(".")[1] + "</code><span>" + esc(f.text) + "</span></div>";
    h += '<div class="chips">' + (f.required ? '<span class="tag req">required</span>' : "") + (n.kind === "core" ? '<span class="tag ' + c + '">' + (d ? (d.accepted ? "accepted gap" : d.status) : "not decided") + "</span>" : "") + "</div>";
    if (d && (d.where.length || d.note || d.accepted)) {
      h += '<div class="note">' + d.where.map((w) => { const l = D.whereLabels[w]; return l && l.href ? '<a href="' + l.href + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>" : esc(l ? l.label : w); }).join(" · ") + (d.note ? (d.where.length ? " — " : "") + esc(d.note) : "") + (d.accepted ? " · accepted: " + esc(d.accepted) : "") + "</div>";
    }
    const pl = D.places[f.id] || [];
    if (pl.length) {
      h += '<details class="cand"><summary>' + pl.length + ' text matches from locate</summary><div class="places">';
      for (const p of pl) h += '<div class="place">' + (p.href ? '<a href="' + p.href + '" target="_blank" rel="noopener">' + esc(p.sourceId + " " + p.label) + "</a>" : esc(p.sourceId + " " + p.label)) + '<span class="sn">' + esc(p.snippet) + "</span></div>";
      h += "</div></details>";
    }
    h += "</li>";
  }
  h += '</ul></div><div class="col">';
  h += '<div><span class="kick">Terms Kai may not use before this is taught</span><div class="terms" style="margin-top:6px">' + (n.lexicon.length ? n.lexicon.map((t) => "<span>" + esc(t) + "</span>").join("") : '<span class="empty">none</span>') + "</div></div>";
  h += '<span class="kick">Kai\\'s questions</span>' + "<dl><dt>open</dt><dd>" + esc(n.probes.open) + "</dd><dt>why</dt><dd>" + esc(n.probes.why) + "</dd><dt>what if</dt><dd>" + esc(n.probes.whatIf) + "</dd><dt>compute</dt><dd>" + esc(n.probes.compute) + "</dd></dl>";
  if (n.misconception) h += '<div class="mis"><span class="kick">Misconception · ' + esc(n.misconception.id) + "</span><span>Kai says: “" + esc(n.misconception.says) + "”</span><span>Truth: " + esc(n.misconception.truth) + "</span>" + (contra ? "<span>If the learner teaches it: “" + esc(contra.question) + "”</span>" : "") + "</div>";
  if (issues.length) h += '<ul class="issues">' + issues.map((i) => '<li><span class="lv ' + i.level + '">' + i.level + "</span><code>" + esc(i.where) + "</code><span>" + esc(i.msg) + "</span></li>").join("") + "</ul>";
  h += "</div>";
  $("panel").innerHTML = h;
}
$("panel").addEventListener("click", (e) => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); select(a.dataset.go); } });

// validator + question bank
$("issuesSum").textContent = "Validator: " + errors + " errors, " + warns + " warnings";
$("issues").innerHTML = D.issues.length ? D.issues.map((i) => '<li><span class="lv ' + i.level + '">' + i.level + "</span><code>" + esc(i.where) + "</code><span>" + esc(i.msg) + "</span></li>").join("") : '<li class="empty">No issues.</li>';
if (D.questions) {
  const q = D.questions;
  $("qs").innerHTML =
    '<span class="kick">Goal checks</span>' + q.goalChecks.map((x) => "<p><b>" + x.goal + "</b> " + esc(x.question) + '<br><span class="note">Expects: ' + esc(x.expects) + "</span></p>").join("") +
    '<span class="kick">Kai\\'s exam</span>' + q.exam.map((x) => "<p><b>" + x.goal + "</b> " + esc(x.question) + '<br><span class="note">Reference: ' + esc(x.reference) + "</span></p>").join("") +
    '<span class="kick">Fallback lines</span><p>' + Object.entries(q.fallbacks).map(([k, v]) => "<b>" + k + "</b> " + v.map(esc).join(" / ")).join("<br>") + "</p>";
} else $("qs").innerHTML = '<p class="empty">No questions.json yet.</p>';

if (!sel) sel = core[0] ? core[0].id : null;
draw(); panel();
</script>
`;
