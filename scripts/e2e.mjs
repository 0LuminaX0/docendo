// End-to-end walkthrough in a real browser. Screenshots go to .e2e/.
//   pnpm build && pnpm e2e     starts its own server from the build on port 3199, in a safe setup:
//                              demo Kai (no model calls), no Upstash (events go to .data/, not the
//                              study log), no access code, a high burst limit. Stops it afterwards.
//   pnpm e2e <baseUrl>         runs against a server you started yourself (it must be set up the same way).
// Uses your installed Chrome; set CHROME_PATH if it isn't in the default place.

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let server = null;
const TEAM_CODE = process.env.E2E_TEAM_CODE ?? "e2e-team-code";
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password";
let BASE = process.argv[2];
if (!BASE) {
  if (!existsSync(join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("No build found: run pnpm build first (or pass the URL of a running server).");
    process.exit(1);
  }
  // a team code and an admin password, so the start page asks for a code and the admin panel can be checked
  const safe = { DELAYED_TEST_DAYS: "0.00002" /* the follow-up test opens about 2 s after the final test */, OPENROUTER_API_KEY: "", DOCENDO_DEMO: "1", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "", ACCESS_CODE: TEAM_CODE, CODE_SECRET: "", ADMIN_PASSWORD: ADMIN_PW, SESSION_TURNS_PER_MIN: "200" };
  if (await fetch("http://localhost:3199").then(() => true, () => false)) {
    console.error("Port 3199 is already in use (a leftover test server?). Stop it first: kill $(lsof -ti tcp:3199)");
    process.exit(1);
  }
  // its own process group, so stopping it also stops the next-server that pnpm starts
  server = spawn("pnpm", ["exec", "next", "start", "-p", "3199"], { env: { ...process.env, ...safe }, stdio: "ignore", detached: true });
  BASE = "http://localhost:3199";
  for (let i = 0; ; i++) {
    if (await fetch(BASE).then(() => true, () => false)) break;
    if (i > 60) throw new Error("the test server didn't start");
    await new Promise((r) => setTimeout(r, 500));
  }
}
const stopServer = () => {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
  server = null;
};
process.on("exit", stopServer);
const OUT = join(process.cwd(), ".e2e");
mkdirSync(OUT, { recursive: true });
const TOPIC = join(process.cwd(), "topics/bandits");
const bundle = JSON.parse(readFileSync(join(TOPIC, "bundle.json"), "utf8"));
const testItems = JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.filter((q) => !q.off); // the items in use
const FORM_N = testItems.filter((q) => q.form === "A").length; // items a form
// two forms in use: the follow-up test and both forms in the final test can run (since 2026-11-05 the pack serves one;
// the parts that need two are skipped, and come back with a second form)
const TWO_FORMS = new Set(testItems.map((q) => q.form)).size > 1;
/** The questions after the test, before the score: answered (a 5 on every scale, the second choice) or skipped. */
async function passSurvey(page, answer = true) {
  await page.waitForSelector(".survey");
  const hidden = !(await page.$(".big"));
  if (answer) {
    for (const g of await page.$$(".survey-dots")) await g.$eval("button:nth-child(5)", (b) => b.click());
    for (const g of await page.$$(".survey-choices")) await g.$eval("button:nth-child(2)", (b) => b.click());
    await page.$eval(".survey .btn.primary", (b) => b.click());
  } else await page.$eval(".survey-skip", (b) => b.click());
  await page.waitForSelector(".big");
  return hidden;
}

/**
 * Answer the test shown on a page (either form, or the part of a two-form test on screen): right except the ids in
 * `wrong`, "I don't know" for the ids in `idk`, and a reason for every item that asks for one except the ids in
 * `noReason`. Returns the ids in shown order.
 */
async function answerTest(page, wrong = [], idk = [], noReason = []) {
  const shown = await page.$$eval(".q", (els) => els.map((e) => e.dataset.q));
  for (const id of shown) {
    const t = testItems.find((x) => x.id === id);
    const c = await page.$(`.q[data-q="${id}"]`);
    if (idk.includes(id)) await c.$eval(".opt.idk input", (el) => el.click());
    else if (t.kind === "number") await c.$eval(".qans input", (el) => el.focus()), await page.keyboard.type(String(wrong.includes(id) ? t.answer + 10 : t.answer));
    else if (t.kind === "multi") for (const k of wrong.includes(id) ? t.answer.slice(0, 1) : t.answer) await c.$eval(`.opts .opt:nth-child(${k + 1}) input`, (el) => el.click());
    else await c.$eval(`.opts .opt:nth-child(${(wrong.includes(id) ? (t.answer + 1) % t.options.length : t.answer) + 1}) input`, (el) => el.click());
    if (t.reason && !noReason.includes(id) && !idk.includes(id)) await c.$eval(".qwork textarea", (el) => el.focus()), await page.keyboard.type("It follows from how the rule picks.");
  }
  return shown;
}
const practiceItems = JSON.parse(readFileSync(join(TOPIC, "practice.json"), "utf8")).items.filter((p) => !p.off);
/** Answer the pretest questions on screen: "I don't know" where offered, else the second option. Returns their ids. */
async function answerPretest(page) {
  const ids = await page.$$eval(".q", (els) => els.map((e) => e.dataset.q));
  for (const id of ids)
    await page.$eval(`.q[data-q="${id}"]`, (q) => {
      const opts = [...q.querySelectorAll(".opt")];
      (opts.find((o) => o.textContent.includes("I don't know")) ?? opts[1]).querySelector("input").click();
    });
  return ids;
}
const CHROME =
  process.env.CHROME_PATH ??
  { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ??
  "/usr/bin/google-chrome";

const runStarted = new Date();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--disable-gpu"] });

// The defaults: one pretest set and one test form, soft timing (nothing ends at its time). Most of the walkthrough
// checks the study's shape with hard limits and the follow-up test (the pilot's setup, both sets and both forms, gets
// its own part below; the admin part resets the settings later)
const studyShape = (s) => ({ ...s, pretest: { ...s.pretest, both: false }, test: { ...s.test, both: false, followUp: TWO_FORMS }, timing: { soft: false } });
// the walkthrough checks the lesson's help (Kai's card, Rewatch in practice), off by default: switched on for it
{
  const ctx = await browser.createBrowserContext();
  const a = await ctx.newPage();
  await a.goto(BASE + "/admin/login", { waitUntil: "load" });
  await a.type("#pw", ADMIN_PW);
  await a.$eval("form button", (e) => e.click());
  await a.waitForSelector(".adm-main", { timeout: 15000 });
  const status = await a.evaluate(async (two) => {
    const post = (body) => fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
    const base = await post({ action: "reset" });
    return (await post({ action: "save", settings: { ...base.j.settings, pretest: { ...base.j.settings.pretest, both: false }, test: { ...base.j.settings.test, both: false, followUp: two }, timing: { soft: false }, tools: { ...base.j.settings.tools, help: true } } })).status;
  }, TWO_FORMS);
  if (status !== 200) throw new Error(`could not switch the lesson's help on for the walkthrough (${status})`);
  await ctx.close();
  await new Promise((r) => setTimeout(r, 10_500)); // each route keeps the settings for up to 10 s
}
const errors = [];
const checks = [];
const check = (ok, what) => checks.push(`${ok ? "✓" : "✗"} ${what}`);
const notRun = (what) => checks.push(`– skipped (one test form): ${what}`);

async function newPage(width = 1366, height = 900, context = null) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push("console: " + m.text()));
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Move a saved session's start times (dot paths, comma-separated) 90 minutes into the past, as if the time had run. */
const movePast = (page, fields) =>
  page.evaluate((fields) => {
    const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
    const t = Date.now() - 90 * 60_000;
    const set = (o, path) => (path.length === 1 ? (o[path[0]] = t) : set((o[path[0]] ??= {}), path.slice(1)));
    for (const f of fields.split(",")) set(s, f.split("."));
    localStorage.setItem("docendo:session:v1", JSON.stringify(s));
  }, fields);
/** Log in to the admin panel in a context of its own, and save the settings `f` makes of the defaults. */
async function settingsFrom(f) {
  const ctx = await browser.createBrowserContext();
  const a = await ctx.newPage();
  await a.goto(BASE + "/admin/login", { waitUntil: "load" });
  await a.type("#pw", ADMIN_PW);
  await a.$eval("form button", (e) => e.click());
  await a.waitForSelector(".adm-main", { timeout: 15000 });
  const post = (body) => a.evaluate(async (body) => { const r = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; }, body);
  const base = await post({ action: "reset" });
  const r = await post({ action: "save", settings: f(base.j.settings) });
  await ctx.close();
  await wait(10_500); // each route keeps the settings for up to 10 s
  return r.status;
}
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("docendo:session:v1") || "null"));
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage });

async function start(page, welcomeShot = null) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("button[type=submit]");
  if (welcomeShot) await shot(page, welcomeShot);
  if (await page.$("#code")) await page.type("#code", TEAM_CODE); // the start page asks for a code
  // Start stays off until the study consent is ticked
  const offBefore = await page.$eval("button[type=submit]", (b) => b.disabled);
  await page.click(".consent input");
  if (welcomeShot) check(offBefore && !(await page.$eval("button[type=submit]", (b) => b.disabled)), "Start waits for the study consent to be ticked");
  await page.click("button[type=submit]");
  // the pretest: "I don't know" on the knowledge items, the second option on the screening questions (not excluded)
  await page.waitForFunction(() => location.pathname === "/pretest");
  await page.waitForSelector(".q");
  await answerPretest(page);
  if (welcomeShot) await shot(page, "00b-pretest");
  await page.waitForFunction(() => !document.querySelector(".submitbar .btn.primary").disabled);
  await page.click(".submitbar .btn.primary");
  await page.waitForFunction(() => location.pathname === "/watch");
  await page.waitForSelector(".lesson, .frame iframe", { timeout: 15000 }); // the text lesson, or YouTube's player (or the plain fallback)
}

/** Leave the lesson step: a text lesson after its minimum reading time (moved into the past here), the videos without
 * watching (the button asks to confirm first). */
async function leaveWatch(p) {
  if (await p.$(".lesson")) {
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
      // on the last chapter, past the minimum reading time and inside the time limit
      const last = document.querySelectorAll(".lesson-steps li").length - 1;
      localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, readStartedAt: Date.now() - 5 * 60_000, readChapterAt: Date.now() - 5 * 60_000, readAt: last, readMax: last }));
    });
    await p.reload({ waitUntil: "load" });
    await p.waitForSelector(".lesson-nav .btn.primary:not([disabled])");
    await p.click(".lesson-nav .btn.primary");
    // it asks first: the text closes for good
    await p.waitForSelector(".lesson-confirm .btn.primary");
    await p.$eval(".lesson-confirm .btn.primary", (b) => b.click());
  } else {
    await p.click(".aside .btn.primary");
    await p.waitForSelector(".aside .btn.primary.small");
    await p.click(".aside .btn.primary.small");
  }
  await p.waitForFunction(() => location.pathname === "/teach");
}

// ---------- 1. full run: watch, teach until Kai is ready, exercises ----------
const page = await newPage();
await start(page, "00-welcome");
const imagesLoaded = (p) => p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 }).catch(() => {});
await imagesLoaded(page);
const textLesson = !!(await page.$(".lesson"));
if (textLesson) {
  const lessonFile = JSON.parse(readFileSync(join(TOPIC, "lesson.json"), "utf8"));
  const look = () =>
    page.evaluate(() => ({
      shown: [...document.querySelectorAll(".lesson-section")].map((e) => e.dataset.section),
      formulas: document.querySelectorAll(".lesson-formula math").length,
      figures: document.querySelectorAll(".lesson-fig svg").length,
      select: getComputedStyle(document.querySelector(".lesson")).userSelect,
      waits: document.querySelector(".lesson-nav .btn.primary").disabled,
      ahead: [...document.querySelectorAll(".lesson-steps button")].filter((b) => b.disabled).length,
    }));
  const first = await look();
  // every chapter in turn: the chapter's Next opens after a quick read of it (moved into the past here)
  const seen = { formulas: first.formulas, figures: first.figures, shown: [...first.shown] };
  for (let k = 1; k < lessonFile.sections.length; k++) {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
      localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, readChapterAt: Date.now() - 10 * 60_000 }));
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".lesson-nav .btn.primary:not([disabled])");
    await page.click(".lesson-nav .btn.primary");
    await page.waitForFunction((id) => document.querySelector(".lesson-section")?.dataset.section === id, {}, lessonFile.sections[k].id);
    const now = await look();
    await shot(page, `01-read-${k + 1}`, true);
    seen.formulas += now.formulas;
    seen.figures += now.figures;
    seen.shown.push(...now.shown);
  }
  const lastWaits = (await look()).waits;
  // past the reading time, "teach Kai" asks first (the text closes for good); "Back to the text" stays on it
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
    // past the minimum reading time, inside the time limit (hard limits here)
    localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, readStartedAt: Date.now() - 5 * 60_000, readChapterAt: Date.now() - 5 * 60_000 }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".lesson-nav .btn.primary:not([disabled])");
  await page.$eval(".lesson-nav .btn.primary", (b) => b.click());
  await page.waitForSelector(".lesson-confirm");
  const asks = await page.$eval(".lesson-confirm", (e) => /won.t be able to open it again/.test(e.textContent));
  const endSays = await page.$eval(".lesson-end", (e) => /won.t be able to open it again/.test(e.textContent));
  await shot(page, "01-read-confirm");
  await page.$eval(".lesson-confirm .btn.ghost", (b) => b.click());
  await page.waitForSelector(".lesson-nav .btn.primary");
  const stayed = (await page.evaluate(() => location.pathname)) === "/watch";
  check(asks && endSays && stayed, "the lesson's end says the text closes for good, and “teach Kai” asks before closing it (“Back to the text” stays)");
  check(
    first.shown.length === 1 && first.waits && first.ahead === lessonFile.sections.length && seen.shown.join() === lessonFile.sections.map((s) => s.id).join() && seen.formulas === lessonFile.sections.flatMap((x) => x.blocks).filter((b) => b.formula).length && seen.figures === lessonFile.sections.flatMap((x) => x.blocks).filter((b) => b.figure).length && first.select === "none" && lastWaits,
    `the lesson is a text read one chapter at a time (${seen.shown.length} chapters, ${seen.formulas} formulas, ${seen.figures} figures), the chapters ahead closed, that can't be selected; Next waits for a quick read and the last step for the reading time`,
  );
} else {
  await wait(2500); // let the YouTube player paint
  check((await page.$$(".lb-part")).length === (bundle.segments?.length || bundle.videos.length), "the lesson plays as one video with a part per segment");
}
await shot(page, "01-watch", textLesson);
await leaveWatch(page);
await page.waitForSelector(".bubble");
check(!!(await page.$(".skip")), "“I've taught all I can” is there from the first message");
await shot(page, "02-teach-start");

let turns = 0;
let sawMind = false;
const moods = new Set();
while (turns < 32) {
  if (await page.$(".ready")) break;
  const s = await saved(page);
  const node = bundle.nodes.find((n) => n.id === s?.chat?.state?.focus) ?? bundle.nodes[0];
  // vary quality: every 4th answer is vague, so Kai gets confused sometimes
  const facts = node.facts.filter((f) => f.teachable).map((f) => f.text);
  // and every 4th (offset 1) explains just one fact, the case where Kai only partly gets it
  const msg = turns % 4 === 3 || !facts.length ? "Hmm, I'm not sure how to explain that one." : turns % 4 === 1 ? facts[0] : facts.join(" ");
  await page.focus("#msg");
  await page.keyboard.type(msg.slice(0, 1100));
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => {
    const s = JSON.parse(localStorage.getItem("docendo:session:v1") || "null");
    // wait for the saved state too: it lands after the reply, and the next message depends on Kai's focus
    return s && s.chat.turns.filter((t) => t.role === "kai").length > n && s.chat.state?.turn === n;
  }, { timeout: 30000 }, turns + 1);
  turns++;
  (await saved(page)).chat.turns.forEach((t) => t.mood && moods.add(t.mood));
  if (turns === 4) {
    await imagesLoaded(page);
    await shot(page, "03-teach-faces");
  }
  if (turns === 6 && !sawMind) {
    await page.click(".seg button:nth-child(2)");
    await page.waitForSelector(".mind svg");
    await page.click(".m-node:nth-of-type(3)").catch(() => {});
    await wait(300);
    await shot(page, "04-mind-midway", true);
    await page.click(".seg button:nth-child(1)");
    await page.waitForSelector("#msg");
    sawMind = true;
  }
  if (turns === 2 && (await page.$(".help:not([disabled])"))) {
    await page.click(".help");
    await page.waitForSelector(".modal iframe, .modal .passage");
    await wait(800);
    await shot(page, "05-help");
    await page.click(".modal header .iconbtn");
    await page.waitForSelector(".scrim", { hidden: true });
  }
}
const s = await saved(page);
check(s.chat.done, `Kai felt ready after ${turns} messages (limit 30)`);
check(turns <= 30, "no more than 30 learner messages");
// the judge's three reactions; a "great" reply shows as aha (an idea finished) or proud (Kai ready) when it is one
check(["okay", "confused"].every((m) => moods.has(m)) && ["great", "aha", "proud"].some((m) => moods.has(m)), `Kai showed all three reactions (${[...moods].join(", ")})`);
check(moods.has("aha") && moods.has("proud"), "an idea Kai finishes shows as a milestone (aha), and Kai is proud when ready");
await shot(page, "06-teach-done");

// standalone Kai's mind
const mindPage = await newPage(1440, 1000);
await mindPage.goto(BASE + "/mind", { waitUntil: "load" });
await mindPage.waitForSelector(".mind svg");
check((await mindPage.$$(".m-node")).length === bundle.nodes.length, "Kai's mind draws every idea");
await shot(mindPage, "07-mind-final", true);
await mindPage.close();

await page.click(".ready .btn.primary");

// practice, one problem at a time: right on the first try; wrong twice (no tries left); then skip to the test
await page.waitForFunction(() => location.pathname === "/practice");
await page.waitForSelector(".pq");
const nextProblem = async (n) => {
  await page.$eval(".submitbar .btn", (e) => e.click());
  await page.waitForFunction((k) => document.querySelectorAll(".prog li")[k]?.classList.contains("now"), {}, n);
};
// click Check only once React has re-rendered with the answer (the button is disabled until then)
const checkWhenReady = async () => {
  await page.waitForFunction(() => { const b = document.querySelector(".pq .pact .btn.small"); return b && !b.disabled; });
  await page.$eval(".pq .pact .btn.small", (el) => el.click());
};
const pick = (k) => page.$eval(`.pq .opt:nth-child(${k + 1}) input`, (el) => el.click());
// the working field does sums: "=" writes the result after the sum
await page.focus(".pq textarea.work");
await page.keyboard.type("explore picks: 0.8 * 1000 + 200 / 3 =");
await page.waitForFunction(() => /= 866\.666667$/.test(document.querySelector(".pq textarea.work")?.value ?? ""));
check(true, "the working field works out a sum when you type =");
try {
  await pick(practiceItems[0].answer); // p1: the right option
  await checkWhenReady();
  await page.waitForFunction(() => document.querySelector(".pq .bulb.on"), { timeout: 10000 });
} catch (e) {
  await shot(page, "07b-practice-FAILED", true);
  throw e;
}
check((await page.$$(".prog li")).length === practiceItems.length, `practice shows ${practiceItems.length} problems`);
await nextProblem(1);
// p2: a wrong option twice; between the tries, rewatch the lesson moment
const p2 = practiceItems[1];
await pick((p2.answer + 1) % p2.options.length);
await checkWhenReady();
await page.waitForFunction(() => /One more try/.test(document.querySelector(".pq .bulb.off")?.textContent ?? ""));
await page.$eval(".pq .pact .btn.ghost", (e) => e.click());
await page.waitForSelector(".modal iframe, .modal .passage");
await shot(page, "07c-practice-rewatch");
await page.click(".modal header .iconbtn");
await page.waitForSelector(".scrim", { hidden: true });
await pick((p2.answer + 2) % p2.options.length);
await checkWhenReady();
await page.waitForFunction(() => /after the final test/.test(document.querySelector(".pq .bulb.off")?.textContent ?? ""));
const noMore = !(await page.$(".pq .pact .btn.small:not(.ghost)")) && !(await page.$(".solution"));
const clock = await page.$eval(".clock", (e) => e.textContent);
check(noMore && /\d:\d\d/.test(clock), `practice shows a countdown (${clock}), allows two tries, replays the lesson and keeps solutions for later`);
await shot(page, "07b-practice", true);
// Kai's mind during practice: closed to the study's sessions, open to the team's debug session (the shared code), which
// has a link to it in the corner
const mindLink = !!(await page.$(".debug-mind"));
const peek = await newPage(1200, 800);
await peek.goto(BASE + "/mind", { waitUntil: "load" });
await peek.waitForSelector(".mind-page", { timeout: 8000 }).catch(() => {});
check(mindLink && (await peek.evaluate(() => location.pathname)) === "/mind", "the debug session (shared code) keeps Kai's mind open during practice, with a link in the corner");
await peek.close();
for (let n = 2; n < practiceItems.length; n++) await nextProblem(n);
await page.$eval(".submitbar .btn", (e) => e.click());
await page.waitForFunction(() => location.pathname === "/exercises");
await page.waitForSelector(".q");
// the learner's own order, all from one form; every question offers "I don't know" and asks for the reason
const shownIds = await page.$$eval(".q", (els) => els.map((e) => e.dataset.q));
const shownItems = shownIds.map((id) => testItems.find((t) => t.id === id));
const mainForm = shownItems[0].form;
const idks = (await page.$$(".q .opt.idk")).length;
const reasonFields = (await page.$$(".q .qreason textarea")).length;
check(shownIds.length === FORM_N && shownItems.every((t) => t.form === mainForm) && idks === FORM_N && reasonFields === FORM_N, `the final test shows one form (${mainForm}), each question with “I don't know” and a field for the reason (${shownIds.join(" ")})`);
// one choice item wrong, one "I don't know", and one answered without its reason at first
const wrongId = shownItems.find((t) => t.kind === "choice").id;
const idkId = shownItems.find((t) => t.id !== wrongId).id;
const lastId = shownItems.findLast((t) => t.id !== wrongId && t.id !== idkId).id;
await answerTest(page, [wrongId], [idkId], [lastId]);
const blocked = await page.$eval(".submitbar .btn.primary", (b) => b.disabled);
const hinted = !!(await page.$(`.q[data-q="${lastId}"] .qreason-hint`));
// the reason field calculates like the working field: a sum ending in = gets its result
await page.$eval(`.q[data-q="${lastId}"] .qwork textarea`, (el) => el.focus());
await page.keyboard.type("Random picks are spread evenly.\n0.1 / 4 =");
await page.waitForFunction((id) => /= 0\.025$/.test(document.querySelector(`.q[data-q="${id}"] .qwork textarea`)?.value ?? ""), {}, lastId);
const open = await page.$eval(".submitbar .btn.primary", (b) => !b.disabled);
check(blocked && hinted && open, "a question counts as answered only with its reason, and the reason field calculates like the working field");
await shot(page, "08a-exercises");
await page.click(".submitbar .btn.primary");
await page.waitForFunction(() => location.pathname === "/results");
const scoreHidden = await passSurvey(page);
check(scoreHidden, "six questions come after the test, before the score");
const score = (await page.$eval(".big", (e) => e.textContent)).replace(/\s+/g, "");
const reasonShown = await page.$$eval(".your-reason", (els) => els.length);
check(score === `${FORM_N - 2}/${FORM_N}` && reasonShown > 0, `graded on the server: ${score} (one wrong, one “I don't know”), the learner's reasons shown with the explanations`);
check((await page.$$(".review .pq")).length === practiceItems.length, "results show the practice solutions after the test");
await shot(page, "08-results", true);

// ---------- 2. skip straight to the exercises ----------
const skip = await newPage(1366, 900, await browser.createBrowserContext()); // fresh storage
await start(skip);
await leaveWatch(skip);
await skip.waitForSelector(".skip");
await skip.click(".skip");
await skip.waitForSelector(".composer-foot .row .btn.small"); // the confirm row (the "taught all I can" button is a .btn.small too)
await shot(skip, "09-skip-confirm");
await skip.click(".composer-foot .row .btn.small");
// stopping ends the chat in place; the learner moves on with a click
await skip.waitForSelector(".ready .btn.primary");
await wait(1200);
const stayed = await skip.evaluate(() => location.pathname === "/teach");
await shot(skip, "09b-skip-finished");
await skip.click(".ready .btn.primary");
await skip.waitForFunction(() => location.pathname === "/practice");
check(stayed, "stopping from the first message waits for a click, then reaches practice");

// recursive feedback (team sessions can switch the view): Kai solves from its (empty) notebook, the learner
// clicks the faulty step, sees where Kai got it from, corrects Kai once, and Kai tries again
await skip.waitForSelector(".pq");
// the same session in a second tab: it asks which tab to keep using (two tabs would overwrite each other's progress)
{
  const twin = await skip.browserContext().newPage();
  await twin.setViewport({ width: 1366, height: 900 });
  await twin.goto(BASE + "/practice", { waitUntil: "load" });
  const guarded = await twin.waitForSelector(".guard", { timeout: 8000 }).then(() => true, () => false);
  await shot(twin, "09c-second-tab");
  await twin.close();
  check(guarded, "a second tab on the same session asks which tab to keep");
}
await skip.click(".seg button:nth-child(2)");
// Kai starts solving on its own; its notebook sits next to its steps
// Kai writes its steps out at reading speed; then the learner calls it before the light
await skip.waitForSelector(".kattempt .ksteps li", { timeout: 30000 });
const lightEarly = !!(await skip.$(".kattempt .light"));
await skip.waitForSelector(".kcall button", { timeout: 60000 });
await shot(skip, "07c2-kai-call");
const paced = !lightEarly && !(await skip.$(".kattempt .light"));
await skip.$eval(".kcall button:last-of-type", (e) => e.click());
await skip.waitForSelector(".kattempt .light");
check(paced, "Kai's steps are written out first and the light waits for the learner's call");
const kaiWrong = await skip.$eval(".kattempt .light", (e) => e.classList.contains("off"));
const hasNotebook = !!(await skip.$(".nb-paper"));
const knote = await skip.$eval(".kattempt .ksteps", (e) => e.textContent);
await skip.type(".ks-fix textarea", bundle.nodes.find((n) => n.id === "n05").facts.map((f) => f.text).join(" "));
await shot(skip, "07d-kai-solves");
await skip.$eval(".ks-fix .btn.primary", (e) => e.click());
await skip.waitForFunction(() => document.querySelectorAll(".kattempt").length === 2, { timeout: 30000 });
await skip.waitForSelector(".kcall button", { timeout: 60000 });
await skip.$eval(".kcall button:first-of-type", (e) => e.click());
const secondNotes = await skip.evaluate(() => JSON.parse(localStorage.getItem("docendo:session:v1")).chat.state.notebook.length);
check(kaiWrong && hasNotebook && /notes don't cover|notes only say|guess|imagine|You told me/.test(knote) && secondNotes > 0, `Kai solves on its own from its notebook (shown beside it), takes one correction and tries again (${secondNotes} notes after the correction)`);
await wait(2500); // the steps and the new notes finish appearing
await shot(skip, "07e-kai-second-try");
// on to the test and the results: they report Kai's outcome on the problems Kai worked on
for (let n = 1; n < practiceItems.length; n++) {
  await skip.$eval(".submitbar .btn", (e) => e.click());
  await skip.waitForFunction((k) => document.querySelectorAll(".prog li")[k]?.classList.contains("now"), {}, n);
}
await skip.$eval(".submitbar .btn", (e) => e.click());
await skip.waitForFunction(() => location.pathname === "/exercises");
await skip.waitForSelector(".q");
const nq = (await skip.$$(".q")).length;
for (let i = 1; i <= nq; i++) await skip.$eval(`.q:nth-of-type(${i}) .opt input`, (e) => e.click()).catch(() => {});
await skip.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
  const answers = s.testItems.map((q) => (q.kind === "multi" ? [0] : 0));
  const testWork = Object.fromEntries(s.testItems.map((q) => [q.id, "A reason in a few words."]));
  localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, answers, testWork }));
});
await skip.reload({ waitUntil: "load" });
await skip.waitForFunction(() => !document.querySelector(".submitbar .btn.primary").disabled);
await skip.$eval(".submitbar .btn.primary", (e) => e.click());
await skip.waitForFunction(() => location.pathname === "/results");
await passSurvey(skip, false);
await skip.waitForSelector(".review .pq");
const kaiLine = await skip.$eval(".review .pq .tag", (e) => e.textContent);
check(/Kai/.test(kaiLine), `results report Kai's practice outcome in the recursive view (“${kaiLine.trim()}”)`);

// a participant (own code) can't stop teaching at once: the button appears after 12 messages or 8 minutes
const part = await newPage(1366, 900, await browser.createBrowserContext());
await start(part);
await leaveWatch(part);
await part.waitForSelector(".bubble");
await part.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
  localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, team: false }));
});
await part.reload({ waitUntil: "load" });
await part.waitForSelector(".bubble");
check(!(await part.$(".skip")), "participants don't see “I've taught all I can” at the start");
await part.close();

// ---------- 3. phone width ----------
const phone = await newPage(390, 844, await browser.createBrowserContext()); // its own storage: the main page would count as a second tab
await phone.goto(BASE + "/", { waitUntil: "load" });
const finalSession = await saved(page); // after the test: every page is unlocked
await phone.evaluate((v) => localStorage.setItem("docendo:session:v1", v), JSON.stringify(finalSession));
for (const path of ["/teach", "/mind", "/practice", "/results"]) {
  await phone.goto(BASE + path, { waitUntil: "load" });
  await wait(700);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no sideways scroll at 390px on ${path}`);
  if (path === "/teach") {
    // the one-row header: the left group (brand, toggle) must end before the right group (meter) starts
    const gap = await phone.evaluate(() => {
      const kids = (sel) => [...document.querySelectorAll(`${sel} > *`)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const left = Math.max(...kids(".top-start").map((r) => r.right));
      const right = Math.min(...kids(".top-right").map((r) => r.left));
      return right - left;
    });
    check(gap >= 4, `header items don't overlap at 390px (${Math.round(gap)}px apart)`);
  }
  await shot(phone, `10-phone${path.replace("/", "-")}`);
}
// the recursive practice view on a phone: Kai's notebook stacks under its steps
await phone.evaluate((v) => {
  const s = JSON.parse(v);
  localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, practice: { ...s.practice, view: "recursive", current: 1 } }));
}, JSON.stringify(finalSession));
await phone.goto(BASE + "/practice", { waitUntil: "load" });
await phone.waitForSelector(".kattempt .light, .nb-paper", { timeout: 20000 });
await wait(800);
const rfOver = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const wide = rfOver > 0 ? await phone.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").join(".")}`).join(", ")) : "";
check(rfOver <= 0, `no sideways scroll at 390px in the recursive practice view${wide ? ` (too wide: ${wide})` : ""}`);
await shot(phone, "10-phone-practice-kai", true);
const phoneHome = await newPage(390, 844, await browser.createBrowserContext());
await phoneHome.goto(BASE + "/", { waitUntil: "load" });
await phoneHome.waitForSelector("button[type=submit]");
await shot(phoneHome, "10-phone-welcome", true);

// the follow-up on the participant's side: a finished session whose graded test came with a follow-up date shows the
// invitation on the results page, and the welcome page offers "Take the follow-up test" (the server decides if open)
if (!TWO_FORMS) notRun("the follow-up invitation on the results and welcome pages");
else {
  const fp = await newPage(1366, 900, await browser.createBrowserContext());
  await fp.goto(BASE + "/", { waitUntil: "load" });
  const later = Date.now() + 3 * 86_400_000;
  await fp.evaluate((v) => localStorage.setItem("docendo:session:v1", v), JSON.stringify({ ...finalSession, team: false, result: { ...finalSession.result, followUp: { opensAt: later } } }));
  await fp.goto(BASE + "/results", { waitUntil: "load" });
  const invited = await fp.waitForSelector(".followup-card", { timeout: 10000 }).then(() => true, () => false);
  await fp.goto(BASE + "/", { waitUntil: "load" });
  await fp.waitForSelector(".intro-go .btn");
  const offered = await fp.$$eval(".intro-go .btn", (bs) => bs.some((b) => /follow-up test/i.test(b.textContent)));
  const hint = await fp.$eval(".intro-go", (e) => /scheduled for/i.test(e.textContent));
  await fp.close();
  check(invited && offered && hint, "the results page invites people back for the follow-up, and the welcome page offers it with the scheduled date");
}

// voice input: the mic shows beside Send when a model is set up (hidden in demo mode; here the flag is flipped
// in the browser only, so the button renders; the server stays in demo mode and refuses to transcribe)
{
  const v = await (await browser.createBrowserContext()).newPage(); // a plain page: the refused request logs a 503 on purpose
  await v.setViewport({ width: 1366, height: 900 });
  await start(v);
  await leaveWatch(v);
  const noMicInDemo = !(await v.$(".voice-btn"));
  await v.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
    localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, demo: false }));
  });
  await v.reload({ waitUntil: "load" });
  await v.waitForSelector(".voice-btn", { timeout: 10000 });
  const refused = await v.evaluate(async (token) => (await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "audio/wav", "x-docendo-token": token, "x-docendo-where": "teach" }, body: new Uint8Array(8000) })).status, JSON.parse(await v.evaluate(() => localStorage.getItem("docendo:session:v1"))).token);
  await shot(v, "03b-teach-voice");
  check(noMicInDemo && refused === 503, `voice input: no mic in demo mode, a mic beside Send otherwise; the demo server refuses to transcribe (${refused})`);
  await v.close();
}

// time limits: every timed step shows its clock, says its limit up front, and ends itself when its time is up (the
// saved start moved into the past here): the pretest and the test are handed in as they are, the lesson closes, Kai
// wraps up, practice goes on to the test
{
  const tl = await newPage(1280, 860, await browser.createBrowserContext());
  const past = (field) =>
    tl.evaluate((field) => {
      const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
      const t = Date.now() - 90 * 60_000;
      const set = (o, path) => (path.length === 1 ? (o[path[0]] = t) : set((o[path[0]] ??= {}), path.slice(1)));
      for (const f of field.split(",")) set(s, f.split("."));
      localStorage.setItem("docendo:session:v1", JSON.stringify(s));
    }, field);
  const clockOn = () => tl.$eval(".top .clock", (e) => /\d:\d\d/.test(e.textContent)).catch(() => false);
  const said = () => tl.evaluate(() => /minutes/.test(document.querySelector("main")?.textContent ?? ""));
  const got = {};
  await tl.goto(BASE + "/", { waitUntil: "load" });
  await tl.waitForSelector("button[type=submit]");
  got.welcome = await tl.evaluate(() => /time limit/i.test(document.querySelector(".intro-head")?.textContent ?? ""));
  if (await tl.$("#code")) await tl.type("#code", TEAM_CODE);
  await tl.click(".consent input");
  await tl.click("button[type=submit]");
  await tl.waitForFunction(() => location.pathname === "/pretest");
  await tl.waitForSelector(".q");
  got.pretest = (await clockOn()) && (await said());
  await past("pretestStartedAt");
  await tl.reload({ waitUntil: "load" });
  await tl.waitForFunction(() => location.pathname === "/watch", { timeout: 15000 });
  await tl.waitForSelector(".lesson");
  got.read = (await clockOn()) && (await said());
  await past("readStartedAt,readChapterAt");
  await tl.reload({ waitUntil: "load" });
  await tl.waitForFunction(() => location.pathname === "/teach", { timeout: 15000 });
  await tl.waitForSelector(".bubble");
  got.teach = (await clockOn()) && /^0 \/ \d+$/.test(await tl.$eval(".top .count", (e) => e.textContent.trim())) && !/question/i.test(await tl.$eval(".top", (e) => e.textContent)) && (await said());
  // on a laptop the step bars in the middle and the clock, Kai's question count and meter on the right keep apart
  const headerGap = async (w) => {
    await tl.setViewport({ width: w, height: 860 });
    await wait(300);
    return tl.evaluate(() => {
      const phase = [...document.querySelectorAll(".top .phase > *")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const right = [...document.querySelectorAll(".top-right > *")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      return phase.length ? Math.min(...right.map((r) => r.left)) - Math.max(...phase.map((r) => r.right)) : 99;
    });
  };
  const gaps = [await headerGap(1280), await headerGap(1440), await headerGap(1024)];
  await tl.setViewport({ width: 1280, height: 860 });
  got.header = gaps.every((g) => g >= 8);
  if (!got.header) console.log(`  teach header gaps at 1280, 1440, 1024: ${gaps.map(Math.round).join(", ")}px`);
  await past("chat.startedAt");
  await tl.reload({ waitUntil: "load" });
  await tl.waitForFunction(() => /Time's up/.test(document.querySelector(".ready h2")?.textContent ?? ""), { timeout: 15000 });
  got.teachEnds = !(await tl.$("#msg"));
  await tl.click(".ready .btn.primary");
  await tl.waitForFunction(() => location.pathname === "/practice", { timeout: 15000 });
  await past("practice.startedAt");
  await tl.reload({ waitUntil: "load" });
  await tl.waitForFunction(() => location.pathname === "/exercises", { timeout: 20000 });
  await tl.waitForSelector(".q");
  got.test = (await clockOn()) && (await said());
  await past("testStartedAt");
  await tl.reload({ waitUntil: "load" });
  await tl.waitForFunction(() => location.pathname === "/results", { timeout: 20000 });
  const st = await saved(tl);
  got.graded = !!st.result && st.result.items.every((x) => !x.correct);
  check(
    Object.values(got).every(Boolean),
    `every step is timed: a clock and its limit on the pretest, the lesson, teaching (with Kai's question count) and the test; at the limit the pretest is handed in, the lesson closes, Kai wraps up, practice and the test end (${Object.entries(got).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all"})`,
  );
  await shot(tl, "13-time-up-results");
  await tl.close();
}

// the pilot's setup: both pretest sets and both test forms, each part with a clock of its own; soft timing: past its
// time the clock counts on ("+…") and nothing ends; each part's time against it is logged and sent with the answers;
// the shared code gets a debug skip, part by part
{
  const ok = await settingsFrom((s) => ({ ...s, pretest: { ...s.pretest, both: true }, test: { ...s.test, both: TWO_FORMS, followUp: false }, tools: { ...s.tools, help: true } }));
  const pl = await newPage(1280, 860, await browser.createBrowserContext());
  const clock = () => pl.$eval(".top .clock", (e) => e.textContent.trim()).catch(() => "");
  const counting = async () => /^\+\d+:\d\d$/.test(await clock());
  const skip = async (path) => (await pl.$eval(".debug-skip", (b) => b.click()), pl.waitForFunction((p) => location.pathname === p, { timeout: 15000 }, path));
  const got = { settings: ok === 200 };
  await pl.goto(BASE + "/", { waitUntil: "load" });
  await pl.waitForSelector("button[type=submit]");
  got.welcome = await pl.evaluate(() => /suggested time/i.test(document.querySelector(".intro-head")?.textContent ?? ""));
  if (await pl.$("#code")) await pl.type("#code", TEAM_CODE);
  await pl.click(".consent input");
  await pl.click("button[type=submit]");
  await pl.waitForFunction(() => location.pathname === "/pretest");
  await pl.waitForSelector(".q");
  got.pretestParts = /Part 1 of 2/.test(await pl.$eval(".quiz-section", (e) => e.textContent).catch(() => ""));
  got.skipShown = !!(await pl.$(".debug-skip"));
  await movePast(pl, "pretestStartedAt");
  await pl.reload({ waitUntil: "load" });
  await pl.waitForSelector(".q");
  await wait(1200);
  got.pretestOn = (await pl.evaluate(() => location.pathname)) === "/pretest" && (await counting());
  await shot(pl, "14-pilot-pretest-overtime");
  await answerPretest(pl);
  await pl.click(".submitbar .btn.primary");
  await pl.waitForSelector(".pre-done");
  await wait(1200);
  const st1 = await saved(pl);
  got.ownClock = /^\d+:\d\d$/.test(await clock()) && st1.pretestTimes?.length === 1 && st1.pretestTimes[0].over === true && st1.pretestTimes[0].limitMs === 4 * 60_000;
  await answerPretest(pl); // every question answered, then the skip hands them in
  await skip("/watch");
  await pl.waitForSelector(".lesson");
  await movePast(pl, "readStartedAt,readChapterAt");
  await pl.reload({ waitUntil: "load" });
  await pl.waitForSelector(".lesson");
  await wait(1200);
  got.readOn = (await pl.evaluate(() => location.pathname)) === "/watch" && (await counting());
  // the skip goes one chapter at a time, and from the last on to Kai
  const chapters = JSON.parse(readFileSync(join(TOPIC, "lesson.json"), "utf8")).sections.length;
  for (let k = 1; k < chapters; k++) {
    await pl.$eval(".debug-skip", (b) => b.click());
    await pl.waitForFunction((k) => document.querySelectorAll(".lesson-steps button.now")[0]?.closest("li") === document.querySelectorAll(".lesson-steps li")[k], { timeout: 10000 }, k);
  }
  got.skipByChapter = (await pl.evaluate(() => location.pathname)) === "/watch";
  await skip("/teach");
  await pl.waitForSelector(".bubble");
  await movePast(pl, "chat.startedAt");
  await pl.reload({ waitUntil: "load" });
  await pl.waitForSelector(".bubble");
  await wait(1500);
  got.teachOn = !!(await pl.$("#msg")) && (await counting()) && !(await pl.$(".ready"));
  await skip("/practice");
  await movePast(pl, "practice.startedAt");
  await pl.reload({ waitUntil: "load" });
  await wait(2000);
  got.practiceOn = (await pl.evaluate(() => location.pathname)) === "/practice" && (await counting());
  await skip("/exercises");
  await pl.waitForSelector(".q");
  got.testParts = !TWO_FORMS || /Part 1 of 2/.test(await pl.$eval(".quiz-section", (e) => e.textContent).catch(() => ""));
  await movePast(pl, "testStartedAt");
  await pl.reload({ waitUntil: "load" });
  await pl.waitForSelector(".q");
  await wait(1200);
  got.testOn = (await pl.evaluate(() => location.pathname)) === "/exercises" && (await counting());
  await shot(pl, "14-pilot-test-overtime");
  await answerTest(pl);
  if (TWO_FORMS) {
    await pl.click(".submitbar .btn.primary");
    await pl.waitForSelector(".quiz-done");
    got.testOwnClock = /^\d+:\d\d$/.test(await clock());
  }
  await skip("/results");
  const st2 = await saved(pl);
  got.graded = !!st2.result && st2.result.parts?.length === (TWO_FORMS ? 2 : 1);
  check(
    Object.values(got).every(Boolean),
    `the pilot: two pretest parts and ${TWO_FORMS ? "two test parts" : "the test"}, each with its own clock; past its time the clock counts on and nothing ends (pretest, lesson, teaching, practice, test); the shared code skips part by part (${Object.entries(got).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all"})`,
  );
  await pl.close();
  // back to the study's shape for the parts that follow
  await settingsFrom((s) => ({ ...studyShape(s), tools: { ...s.tools, help: true } }));
}

// the admin panel: the login gate, the dashboard, a code made and used, an export
{
  // a plain page: the deliberate 401 (a one-use code used twice) must not count as a page error
  const adm = await (await browser.createBrowserContext()).newPage();
  await adm.setViewport({ width: 1366, height: 900 });
  adm.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await adm.goto(BASE + "/admin", { waitUntil: "load" });
  const gated = adm.url().endsWith("/admin/login");
  await adm.type("#pw", ADMIN_PW);
  await adm.$eval("form button", (e) => e.click());
  await adm.waitForSelector(".adm-main", { timeout: 15000 }); // the participants' view may be empty (no tiles then)
  await adm.goto(BASE + "/admin?all=1", { waitUntil: "load" });
  const sessions = Number(await adm.$eval(".adm-kpis > div b", (e) => e.textContent));
  await shot(adm, "11-admin-dashboard", true);
  const post = (path, body) => adm.evaluate(async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, path, body);
  const made = await post("/api/admin/codes", { action: "create", count: 2, prefix: "E2E", label: "walkthrough", condition: "recursive", team: false, maxUses: 1 });
  const code = made.json.codes?.[0]?.code;
  const noConsent = await post("/api/session", { accessCode: code });
  const used = await post("/api/session", { accessCode: code, consent: true });
  const twice = await post("/api/session", { accessCode: code, consent: true });
  check(noConsent.status === 400, "a session doesn't start without the study consent, whatever the browser sends");

  if (!TWO_FORMS) notRun("the delayed test with the same code, and opening it early from the Follow-up page");
  else {
  // the delayed test: this code's participant takes the final test, comes back with the same code once the follow-up
  // is open (about 2 s on this server), and gets the other form, with the "studied it since?" question first
  const firstForm = (await post("/api/grade", { token: used.json.token, kind: "items" })).json.form;
  const graded = await post("/api/grade", { token: used.json.token, answers: Array(FORM_N).fill(null) });
  const early = await post("/api/session", { accessCode: code, consent: true });
  await wait(2500);
  const fu = await (await browser.createBrowserContext()).newPage();
  await fu.setViewport({ width: 1366, height: 900 });
  fu.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await fu.goto(BASE + "/", { waitUntil: "load" });
  await fu.waitForSelector("#code");
  await fu.type("#code", code);
  await fu.click(".consent input");
  await fu.click("button[type=submit]");
  await fu.waitForFunction(() => location.pathname === "/exercises", { timeout: 15000 });
  await fu.waitForSelector(".since");
  const fuIds = await fu.$$eval(".q", (els) => els.map((e) => e.dataset.q));
  const otherForm = fuIds.every((id) => testItems.find((t) => t.id === id).form !== firstForm) && fuIds.length === FORM_N;
  await fu.click(".since .opt input");
  await answerTest(fu);
  await shot(fu, "12-follow-up");
  await fu.waitForFunction(() => !document.querySelector(".submitbar .btn.primary").disabled);
  await fu.click(".submitbar .btn.primary");
  await fu.waitForFunction(() => location.pathname === "/results");
  await fu.waitForSelector(".big");
  const fuScore = (await fu.$eval(".big", (e) => e.textContent)).replace(/\s+/g, "");
  await shot(fu, "12b-follow-up-results", true);
  const again = await post("/api/session", { accessCode: code, consent: true });
  check(
    typeof graded.json.followUp?.opensAt === "number" && early.status === 409 && /opens on/.test(early.json.error) && otherForm && fuScore === `${FORM_N}/${FORM_N}` && again.status === 409 && /both tests/.test(again.json.error),
    `delayed test: the graded test says when it opens; not before; then the same code gives the other form (${firstForm} first), graded ${fuScore}; then "done both"`,
  );
  await fu.close();

  // opened early from the admin panel: with a 30-day schedule a trial participant is told to wait, the admin opens it
  // now (the Follow-up page's action), and the same code starts the follow-up test
  const sched = await post("/api/admin/followup", { action: "setting", followUp: true, followUpDays: 30 });
  await wait(10_500); // each route keeps the settings for up to 10 s
  const made2 = (await post("/api/admin/codes", { action: "create", count: 1, prefix: "FU", label: "e2e follow-up", condition: "direct", trial: true, maxUses: 1 })).json.codes?.[0];
  const s2 = await post("/api/session", { accessCode: made2.code, consent: true });
  const g2 = await post("/api/grade", { token: s2.json.token, answers: Array(FORM_N).fill(null) });
  const tooSoon = await post("/api/session", { accessCode: made2.code, consent: true });
  await adm.goto(BASE + "/admin/follow-up", { waitUntil: "load" });
  const waiting = await adm.$$eval("tbody tr", (rows) => rows.filter((r) => r.textContent.includes("waiting")).length);
  await shot(adm, "11-admin-follow-up", true);
  const opened = await post("/api/admin/followup", { action: "open", pids: [made2.id] });
  const back2 = await post("/api/session", { accessCode: made2.code, consent: true });
  await post("/api/admin/codes", { action: "delete", code: made2.code });
  check(
    sched.status === 200 && g2.json.followUp?.opensAt > Date.now() + 20 * 86_400_000 && tooSoon.status === 409 && waiting > 0 && opened.json.changed === 1 && back2.status === 200 && back2.json.phase === "delayed",
    `follow-up opened early: a 30-day schedule makes a trial code wait (listed on Follow-up as waiting), "Open now" lets the same code start it (${back2.json.phase})`,
  );
  }
  const csv = await adm.evaluate(async () => (await (await fetch("/api/admin/export?table=sessions")).text()).split("\n")[0]);
  // settings: a change reaches the participant pages, is versioned, and goes back to the defaults
  const base = await post("/api/admin/settings", { action: "reset" });
  const saved = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, practice: { ...base.json.settings.practice, minutes: 13 } } });
  // each route keeps its own 10 s cache of the settings: the change shows within seconds
  let shown = false;
  for (let k = 0; k < 16 && !shown; k++) (shown = await adm.evaluate(async () => /13(<!-- -->)? minutes/.test(await (await fetch("/")).text()))), shown || (await wait(1000));
  const badSave = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, watch: { on: true, parts: [{ ...base.json.settings.watch.parts[0], videoId: "nope" }] } } });
  // the pilot's pretest: every set, one after the other as parts, in an order that alternates with the test form
  const preBoth = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, pretest: { on: true, both: true } } });
  let preShown = false;
  for (let k = 0; k < 16 && !preShown; k++) (preShown = await adm.evaluate(async () => /starting with 13 quick questions/.test(await (await fetch("/")).text()))), preShown || (await wait(1000));
  await wait(10_500); // the pretest page keeps its own copy of the settings for up to 10 s
  const pre = await newPage(1366, 900, await browser.createBrowserContext());
  await pre.goto(BASE + "/", { waitUntil: "load" });
  await pre.waitForSelector("button[type=submit]");
  if (await pre.$("#code")) await pre.type("#code", TEAM_CODE);
  await pre.click(".consent input");
  await pre.click("button[type=submit]");
  await pre.waitForFunction(() => location.pathname === "/pretest", { timeout: 15000 });
  await pre.waitForSelector(".q");
  const prePart1 = await answerPretest(pre);
  const preGoOn = await pre.$eval(".submitbar .btn.primary", (b) => b.textContent);
  await pre.click(".submitbar .btn.primary");
  await pre.waitForSelector(".pre-done");
  const prePart2 = await answerPretest(pre);
  await shot(pre, "00c-pretest-pilot-part-2");
  const preForm = await pre.evaluate(() => JSON.parse(atob(JSON.parse(localStorage.getItem("docendo:session:v1")).token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).form);
  await pre.click(".submitbar .btn.primary");
  await pre.waitForFunction(() => location.pathname === "/watch", { timeout: 15000 });
  await pre.close();
  const firstSet = preForm === "B" ? "h" : "k";
  check(
    preBoth.status === 200 && preShown && prePart1.length === 8 && prePart1.slice(0, 3).join() === "q1,q2,q3" && prePart1[3].startsWith(firstSet) && prePart2.length === 5 && !prePart2[0].startsWith(firstSet) && /part 2/i.test(preGoOn),
    `the pilot's pretest: the screening questions and one set, then the other set as part 2 (form ${preForm}: ${firstSet === "k" ? "C1" : "C2"} first), then the lesson`,
  );
  // a step switched off: the welcome page drops its card, and a session goes past it (practice → straight to the test)
  // (and the pilot's test: both forms, one after the other)
  const noPractice = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, pretest: { on: false }, watch: { ...base.json.settings.watch, on: false }, practice: { ...base.json.settings.practice, on: false }, test: { ...base.json.settings.test, followUp: false, both: TWO_FORMS } } });
  const bothAndFollowUp = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, test: { ...base.json.settings.test, followUp: true, both: true } } });
  let skipped = false;
  for (let k = 0; k < 16 && !skipped; k++) (skipped = await adm.evaluate(async () => { const h = await (await fetch("/")).text(); return !/<h3>Practice<\/h3>/.test(h) && /<h3>Teach Kai<\/h3>/.test(h); })), skipped || (await wait(1000));
  // a session in the browser under that setup: it opens on Teach Kai, shows two step bars, keeps the practice page
  // closed and goes from teaching straight to the test (each page keeps the settings for up to 10 s: wait them out)
  await wait(10_500);
  const short = await newPage(1366, 900, await browser.createBrowserContext());
  await short.goto(BASE + "/", { waitUntil: "load" });
  await short.waitForSelector("button[type=submit]");
  if (await short.$("#code")) await short.type("#code", TEAM_CODE);
  await short.click(".consent input");
  await short.click("button[type=submit]");
  await short.waitForFunction(() => location.pathname === "/teach", { timeout: 15000 });
  const bars = await short.$$eval(".arms i", (els) => els.length);
  await short.goto(BASE + "/practice", { waitUntil: "load" });
  await short.waitForFunction(() => location.pathname === "/teach", { timeout: 15000 }); // not reached, and switched off
  await short.waitForSelector(".skip");
  await short.click(".skip");
  await short.waitForSelector(".composer-foot .row .btn.small");
  await short.click(".composer-foot .row .btn.small");
  await short.waitForSelector(".ready .btn.primary");
  const toTest = await short.$eval(".ready .btn.primary", (b) => b.textContent);
  await short.click(".ready .btn.primary");
  await short.waitForFunction(() => location.pathname === "/exercises", { timeout: 15000 });
  check(bars === 2 && /test/i.test(toTest), `with the pretest, video and practice off a session opens on Teach Kai (${bars} step bars), keeps practice closed and goes on to the test ("${toTest?.trim()}")`);
  // the pilot's test: both forms as two parts, the session's own form first; part 2 opens once part 1 is complete,
  // and part 1 is then locked; the anchor (V9 = T10) is asked once
  await short.waitForSelector(".q");
  if (!TWO_FORMS) {
    // one form: its items in one part; both forms (or a follow-up) are refused while there is only one
    const only = await answerTest(short);
    await short.click(".submitbar .btn.primary");
    await short.waitForFunction(() => location.pathname === "/results");
    await short.close();
    check(noPractice.status === 200 && bothAndFollowUp.status === 400 && only.length === FORM_N, `one test form in use (${FORM_N} items, in one part); both forms with a follow-up are refused`);
  } else {
  const part1 = await answerTest(short);
  const goOn = await short.$eval(".submitbar .btn.primary", (b) => b.textContent);
  await short.click(".submitbar .btn.primary");
  await short.waitForSelector(".quiz-done");
  const part2Ids = await short.$$eval(".q", (els) => els.map((e) => e.dataset.q));
  const part2 = await answerTest(short, [], [part2Ids[0]]);
  await shot(short, "08c-pilot-part-2");
  await short.click(".submitbar .btn.primary");
  await short.waitForFunction(() => location.pathname === "/results");
  await passSurvey(short);
  const pilotScore = (await short.$eval(".big", (e) => e.textContent)).replace(/\s+/g, "");
  const perPart = await short.$eval(".parts-score", (e) => e.textContent);
  await shot(short, "08d-pilot-results", true);
  await short.close();
  const formOf = (id) => testItems.find((t) => t.id === id).form;
  const asked = [...part1, ...part2];
  // each form's items in use; the anchor is asked once, and the first of part 2 is answered wrongly
  const n = testItems.filter((t) => t.form === "A").length;
  check(
    noPractice.status === 200 && bothAndFollowUp.status === 400 && part1.length === n && part2.length === n - 1 && part1.every((id) => formOf(id) === formOf(part1[0])) && part2.every((id) => formOf(id) !== formOf(part1[0])) && !(asked.includes("t10") && asked.includes("v09")) && /part 2/i.test(goOn) && pilotScore === `${2 * n - 2}/${2 * n - 1}` && new RegExp(`Part 1: ${n} of ${n}, Part 2: ${n - 2} of ${n - 1}`).test(perPart),
    `the pilot's test: both forms in two parts (${formOf(part1[0])} first), part 2 after part 1 is complete, the anchor once, graded ${pilotScore} (${perPart}); with a follow-up as well it is refused`,
  );
  }
  const back = await post("/api/admin/settings", { action: "reset" });
  await adm.goto(BASE + "/admin/settings", { waitUntil: "load" });
  const blocks = await adm.$$eval(".study-block", (els) => els.length);
  await shot(adm, "11-admin-settings", true);
  check(saved.status === 200 && saved.json.version !== base.json.version && shown && badSave.status === 400 && noPractice.status === 200 && skipped && back.json.version === base.json.version && blocks === 7, `study setup: a change reaches the pages within seconds (${saved.json.version}), a step switched off drops out, a bad one is refused, the defaults come back, ${blocks} blocks listed`);
  // a trial code: a participant's experience (no shortcuts), counted with the tests
  const trialCode = (await post("/api/admin/codes", { action: "create", count: 1, prefix: "TRY", label: "e2e trial", condition: "direct", trial: true, maxUses: null })).json.codes?.[0]?.code;
  const trial = await post("/api/session", { accessCode: trialCode, consent: true });
  await post("/api/admin/codes", { action: "delete", code: trialCode });
  check(trial.status === 200 && trial.json.team === false && !trial.json.debug, "a trial code gives a participant's session (no shortcuts, no debug skip)");
  // the other admin pages render
  const pages = [];
  for (const [path, sel] of [["/admin/live", ".adm-live"], ["/admin/content", ".cnt-ideas"], ["/admin/health", ".adm-kpis"], ["/admin/sessions?scope=team", ".adm-sessions"], ["/admin/feedback", ".adm-view"]]) {
    await adm.goto(BASE + path, { waitUntil: "load" });
    if (!(await adm.$(sel))) pages.push(path);
  }
  await adm.goto(BASE + "/admin/content", { waitUntil: "load" });
  await shot(adm, "11-admin-content", true);
  await adm.goto(BASE + "/admin/live", { waitUntil: "load" });
  await shot(adm, "11-admin-live", true);
  check(!pages.length, `admin pages render: live, topic content, health, sessions, feedback${pages.length ? ` (failed: ${pages.join(", ")})` : ""}`);
  await adm.goto(BASE + "/admin/codes", { waitUntil: "load" });
  await shot(adm, "11-admin-codes", true);
  for (const c of made.json.codes ?? []) await post("/api/admin/codes", { action: "delete", code: c.code });
  check(
    gated && sessions > 0 && used.json.condition === "recursive" && used.json.team === false && twice.status === 401 && csv.startsWith("sid,"),
    `admin panel: login gate, dashboard (${sessions} sessions), a one-use recursive code works once, CSV export`,
  );
  await adm.close();
}

// the research log (local server without Upstash: .data/events.jsonl, written right after each response)
await wait(1500);
const logFile = join(process.cwd(), ".data", "events.jsonl");
if (existsSync(logFile)) {
  const since = runStarted.toISOString();
  const evs = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.at >= since);
  const has = (t) => evs.some((e) => e.t === t);
  const need = ["session_start", "pretest", "chat_turn", "practice_check", "practice_hint", "notebook_snapshot", "client_practice_problem_leave", "client_practice_skip", "practice_kai_solve", "practice_kai_reteach", "grade", "client_page_view", "client_message_send", textLesson ? "client_read_continue" : "client_watch_continue_early", "client_skip_confirm", "client_survey"];
  const missing = need.filter((t) => !has(t));
  const pilotPre = evs.find((e) => e.t === "pretest" && Array.isArray(e.sets) && e.sets.length === 2);
  const onePre = evs.find((e) => e.t === "pretest" && Array.isArray(e.sets) && e.sets.length === 1);
  check(pilotPre && pilotPre.of === 10 && pilotPre.dontKnow === 10 && !pilotPre.excluded && onePre && onePre.of === 5 && pilotPre.setScores && has("client_pretest_part"), "the pretest logs the sets taken in order and the score in each (5 items, or 10 in the pilot)");
  const turn = evs.find((e) => e.t === "chat_turn");
  check(!missing.length && turn && "message" in turn && "reply" in turn && "mood" in turn && "elapsedMs" in turn, `research log has every kind of event (${evs.length} this run${missing.length ? `; missing ${missing.join(", ")}` : ""})`);
  const pilot = evs.find((e) => e.t === "grade" && Array.isArray(e.forms) && e.forms.length === 2);
  if (!TWO_FORMS) notRun("the pilot's two-form test in the log");
  else check(has("client_test_part") && pilot && pilot.formScores && pilot.items.every((it) => "reason" in it && it.form) && pilot.copies.length === 1, "the pilot's test logs each part, each form's score (the anchor in both) and every reason");
  // the pilot's timing: each part's time against its own, with the answers; every other step's from the browser
  const timedPre = evs.find((e) => e.t === "pretest" && e.times?.length === 2);
  const timedTest = evs.find((e) => e.t === "grade" && e.times?.length === (TWO_FORMS ? 2 : 1) && e.skipped === true);
  const stepTimes = new Set(evs.filter((e) => e.t === "client_step_time").map((e) => e.step));
  check(
    timedPre && timedPre.times.every((t) => t.limitMs === 4 * 60_000) && timedPre.times[0].over && timedTest && timedTest.times.every((t) => t.limitMs === 10 * 60_000) && ["watch", "teach", "practice"].every((k) => stepTimes.has(k)) && has("client_debug_skip"),
    "the pilot logs every part's time against its own (pretest 4 and test 10 minutes a part, with the answers; the lesson, teaching and practice from the browser) and each debug skip",
  );
} else check(false, "research log written to .data/events.jsonl");

// nothing secret in what the browser downloads (client scripts and prerendered pages):
// worked solutions, test explanations, lesson facts. A public practice prompt must be found, so the scan is real.
const staticDir = join(process.cwd(), ".next", "static");
const pagesDir = join(process.cwd(), ".next", "server", "app");
if (existsSync(staticDir)) {
  const read = (dir, re) => readdirSync(dir, { recursive: true }).filter((f) => re.test(String(f))).map((f) => readFileSync(join(dir, String(f)), "utf8"));
  // the built files, and every participant page as the server renders it (pages are rendered per request now)
  const rendered = [];
  for (const path of ["/", "/pretest", "/watch", "/teach", "/mind", "/practice", "/exercises", "/results"]) rendered.push(await fetch(BASE + path).then((r) => r.text(), () => ""));
  const shipped = [...read(staticDir, /\.(js|css|json)$/), ...read(pagesDir, /\.(html|rsc)$/), ...rendered].join("\n");
  check(shipped.includes(practiceItems[0].prompt.slice(0, 40)), "the bundle scan sees what the browser gets (a public practice prompt is found)");
  const lessonText = existsSync(join(TOPIC, "lesson.json")) ? readFileSync(join(TOPIC, "lesson.json"), "utf8") : "";
  const secrets = [
    ...practiceItems.flatMap((p) => p.steps.map((st) => st.text)),
    ...JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.map((q) => q.explain),
    // the test questions too: they come per session from the server (its own form), never with the page
    ...JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.map((q) => q.prompt),
    // a fact the text lesson itself states (participants read it on purpose) is no leak
    ...bundle.nodes.flatMap((n) => n.facts.map((f) => f.text)).filter((t) => !lessonText.includes(t.slice(0, 40))),
  ].map((t) => t.slice(0, 40));
  const leaked = secrets.filter((t) => shipped.includes(t));
  check(!leaked.length, `the browser bundle holds no solution, explanation, test question or lesson fact (${secrets.length} checked${leaked.length ? `; found: ${leaked.slice(0, 3).join(" | ")}` : ""})`);
}

await browser.close();
stopServer();
console.log(checks.join("\n"));
console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
process.exit(checks.some((c) => c.startsWith("✗")) || errors.length ? 1 : 0);
