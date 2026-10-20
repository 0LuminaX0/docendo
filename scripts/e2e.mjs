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
const testItems = JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items;
const answers = testItems.map((q) => q.answer);
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

/** Answer the test shown on a page (either form), right except the ids in `wrong`; returns the ids in shown order. */
async function answerTest(page, wrong = []) {
  const shown = await page.$$eval(".q", (els) => els.map((e) => e.dataset.q));
  for (const id of shown) {
    const t = testItems.find((x) => x.id === id);
    const c = await page.$(`.q[data-q="${id}"]`);
    if (t.kind === "number") await c.$eval(".qans input", (el) => el.focus()), await page.keyboard.type(String(wrong.includes(id) ? t.answer + 10 : t.answer));
    else await c.$eval(`.opt:nth-child(${(wrong.includes(id) ? (t.answer + 1) % 4 : t.answer) + 1}) input`, (el) => el.click());
  }
  return shown;
}
const practiceItems = JSON.parse(readFileSync(join(TOPIC, "practice.json"), "utf8")).items;
const CHROME =
  process.env.CHROME_PATH ??
  { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ??
  "/usr/bin/google-chrome";

const runStarted = new Date();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--disable-gpu"] });
const errors = [];
const checks = [];
const check = (ok, what) => checks.push(`${ok ? "✓" : "✗"} ${what}`);

async function newPage(width = 1366, height = 900, context = null) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push("console: " + m.text()));
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  // the pretest: five questions, the last option of each ("I don't know" on the knowledge items)
  await page.waitForFunction(() => location.pathname === "/pretest");
  await page.waitForSelector(".q");
  const n = (await page.$$(".q")).length;
  for (let i = 0; i < n; i++) await page.$eval(`.q:nth-child(${i + 1}) .opt:last-child input`, (el) => el.click());
  if (welcomeShot) await shot(page, "00b-pretest");
  await page.waitForFunction(() => !document.querySelector(".submitbar .btn.primary").disabled);
  await page.click(".submitbar .btn.primary");
  await page.waitForFunction(() => location.pathname === "/watch");
  await page.waitForSelector(".frame iframe", { timeout: 15000 }); // YouTube's player (or the plain fallback)
}

/** Leave the watch page without watching: the button asks to confirm first. */
async function leaveWatch(p) {
  await p.click(".aside .btn.primary");
  await p.waitForSelector(".aside .btn.primary.small");
  await p.click(".aside .btn.primary.small");
  await p.waitForFunction(() => location.pathname === "/teach");
}

// ---------- 1. full run: watch, teach until Kai is ready, exercises ----------
const page = await newPage();
await start(page, "00-welcome");
const imagesLoaded = (p) => p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 }).catch(() => {});
await imagesLoaded(page);
await wait(2500); // let the YouTube player paint
check((await page.$$(".lb-part")).length === (bundle.segments?.length || bundle.videos.length), "the lesson plays as one video with a part per segment");
await shot(page, "01-watch");
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
    await page.waitForSelector(".modal iframe");
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
check((await page.$$(".prog li")).length === practiceItems.length, `practice shows ${practiceItems.length} problems in two rounds`);
await nextProblem(1);
// p2: a wrong option twice; between the tries, rewatch the lesson moment
const p2 = practiceItems[1];
await pick((p2.answer + 1) % p2.options.length);
await checkWhenReady();
await page.waitForFunction(() => /One more try/.test(document.querySelector(".pq .bulb.off")?.textContent ?? ""));
await page.$eval(".pq .pact .btn.ghost", (e) => e.click());
await page.waitForSelector(".modal iframe");
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
// Kai's mind stays closed during practice
const peek = await newPage(1200, 800);
await peek.goto(BASE + "/mind", { waitUntil: "load" });
await peek.waitForFunction(() => location.pathname === "/practice", { timeout: 8000 }).catch(() => {});
check((await peek.evaluate(() => location.pathname)) === "/practice", "Kai's mind is closed during practice");
await peek.close();
for (let n = 2; n < practiceItems.length; n++) await nextProblem(n);
await page.$eval(".submitbar .btn", (e) => e.click());
await page.waitForFunction(() => location.pathname === "/exercises");
await page.waitForSelector(".q");
// the learner's own order: the choice items first, then the number items, all from one form
const shownIds = await page.$$eval(".q", (els) => els.map((e) => e.dataset.q));
const shownItems = shownIds.map((id) => testItems.find((t) => t.id === id));
const kindsShown = shownItems.map((t) => t.kind ?? "choice");
const mainForm = shownItems[0].form;
check(shownIds.length === 10 && shownItems.every((t) => t.form === mainForm) && kindsShown.lastIndexOf("choice") < kindsShown.indexOf("number"), `the final test shows one form (${mainForm}): the choice items first, then the number items (${shownIds.join(" ")})`);
// the working field below is checked on q01 (or its twin r01), which it fills with the right answer
const avgId = mainForm === "B" ? "r01" : "q01";
// one choice item and one other number item wrong on purpose
await answerTest(page, [shownItems.find((t) => t.kind !== "number").id, shownItems.findLast((t) => t.kind === "number" && t.id !== avgId).id]);
const avg = await page.$(`.q[data-q="${avgId}"]`);
await avg.$eval(".qwork textarea", (el) => el.focus());
await page.keyboard.type(mainForm === "B" ? "(5 * 18 + 30) / 6 =" : "(4 * 12 + 22) / 5 =");
const want = mainForm === "B" ? "20" : "14";
await page.waitForFunction((id, w) => new RegExp(`= ${w}$`).test(document.querySelector(`.q[data-q="${id}"] .qwork textarea`)?.value ?? ""), {}, avgId, want);
await (await avg.$(".qans input")).click({ count: 3 });
await page.keyboard.press("Backspace");
await avg.$eval(".scratch-bar .linkish", (el) => el.click());
const used = await avg.$eval(".qans input", (el) => el.value);
check(used === want, `the final test has a working field under each question that calculates and fills the answer (${used})`);
await shot(page, "08a-exercises");
await page.click(".submitbar .btn.primary");
await page.waitForFunction(() => location.pathname === "/results");
const scoreHidden = await passSurvey(page);
check(scoreHidden, "six questions come after the test, before the score");
const score = (await page.$eval(".big", (e) => e.textContent)).replace(/\s+/g, "");
check(score === "8/10", `graded on the server: ${score} (2 wrong on purpose)`);
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
check(kaiWrong && hasNotebook && /didn't tell me|guessing|You told me/.test(knote) && secondNotes > 0, `Kai solves on its own from its notebook (shown beside it), takes one correction and tries again (${secondNotes} notes after the correction)`);
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
await skip.evaluate((n) => {
  const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
  localStorage.setItem("docendo:session:v1", JSON.stringify({ ...s, answers: Array(n).fill(0) }));
}, 10);
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
{
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

  // the delayed test: this code's participant takes the final test, comes back with the same code once the follow-up
  // is open (about 2 s on this server), and gets the other form, with the "studied it since?" question first
  const firstForm = (await post("/api/grade", { token: used.json.token, kind: "items" })).json.form;
  const graded = await post("/api/grade", { token: used.json.token, answers: Array(10).fill(null) });
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
  const otherForm = fuIds.every((id) => testItems.find((t) => t.id === id).form !== firstForm) && fuIds.length === 10;
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
    typeof graded.json.followUp?.opensAt === "number" && early.status === 409 && /opens on/.test(early.json.error) && otherForm && fuScore === "10/10" && again.status === 409 && /both tests/.test(again.json.error),
    `delayed test: the graded test says when it opens; not before; then the same code gives the other form (${firstForm} first), graded ${fuScore}; then "done both"`,
  );
  await fu.close();

  // opened early from the admin panel: with a 30-day schedule a trial participant is told to wait, the admin opens it
  // now (the Follow-up page's action), and the same code starts the follow-up test
  const sched = await post("/api/admin/followup", { action: "setting", followUp: true, followUpDays: 30 });
  await wait(10_500); // each route keeps the settings for up to 10 s
  const made2 = (await post("/api/admin/codes", { action: "create", count: 1, prefix: "FU", label: "e2e follow-up", condition: "direct", trial: true, maxUses: 1 })).json.codes?.[0];
  const s2 = await post("/api/session", { accessCode: made2.code, consent: true });
  const g2 = await post("/api/grade", { token: s2.json.token, answers: Array(10).fill(null) });
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
  const csv = await adm.evaluate(async () => (await (await fetch("/api/admin/export?table=sessions")).text()).split("\n")[0]);
  // settings: a change reaches the participant pages, is versioned, and goes back to the defaults
  const base = await post("/api/admin/settings", { action: "reset" });
  const saved = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, practice: { ...base.json.settings.practice, minutes: 13 } } });
  // each route keeps its own 10 s cache of the settings: the change shows within seconds
  let shown = false;
  for (let k = 0; k < 16 && !shown; k++) (shown = await adm.evaluate(async () => /13(<!-- -->)? minutes/.test(await (await fetch("/")).text()))), shown || (await wait(1000));
  const badSave = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, watch: { on: true, parts: [{ ...base.json.settings.watch.parts[0], videoId: "nope" }] } } });
  // a step switched off: the welcome page drops its card, and a session goes past it (practice → straight to the test)
  const noPractice = await post("/api/admin/settings", { action: "save", settings: { ...base.json.settings, pretest: { on: false }, watch: { ...base.json.settings.watch, on: false }, practice: { ...base.json.settings.practice, on: false } } });
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
  await short.close();
  check(bars === 2 && /test/i.test(toTest), `with the pretest, video and practice off a session opens on Teach Kai (${bars} step bars), keeps practice closed and goes on to the test ("${toTest?.trim()}")`);
  const back = await post("/api/admin/settings", { action: "reset" });
  await adm.goto(BASE + "/admin/settings", { waitUntil: "load" });
  const blocks = await adm.$$eval(".study-block", (els) => els.length);
  await shot(adm, "11-admin-settings", true);
  check(saved.status === 200 && saved.json.version !== base.json.version && shown && badSave.status === 400 && noPractice.status === 200 && skipped && back.json.version === base.json.version && blocks === 7, `study setup: a change reaches the pages within seconds (${saved.json.version}), a step switched off drops out, a bad one is refused, the defaults come back, ${blocks} blocks listed`);
  // a trial code: a participant's experience (no shortcuts), counted with the tests
  const trialCode = (await post("/api/admin/codes", { action: "create", count: 1, prefix: "TRY", label: "e2e trial", condition: "direct", trial: true, maxUses: null })).json.codes?.[0]?.code;
  const trial = await post("/api/session", { accessCode: trialCode, consent: true });
  await post("/api/admin/codes", { action: "delete", code: trialCode });
  check(trial.status === 200 && trial.json.team === false, "a trial code gives a participant's session (no shortcuts)");
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
  const need = ["session_start", "pretest", "chat_turn", "practice_check", "practice_hint", "notebook_snapshot", "client_practice_problem_leave", "client_practice_skip", "practice_kai_solve", "practice_kai_reteach", "grade", "client_page_view", "client_message_send", "client_watch_continue_early", "client_skip_confirm", "client_survey"];
  const missing = need.filter((t) => !has(t));
  const turn = evs.find((e) => e.t === "chat_turn");
  check(!missing.length && turn && "message" in turn && "reply" in turn && "mood" in turn && "elapsedMs" in turn, `research log has every kind of event (${evs.length} this run${missing.length ? `; missing ${missing.join(", ")}` : ""})`);
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
  const secrets = [
    ...practiceItems.flatMap((p) => p.steps.map((st) => st.text)),
    ...JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.map((q) => q.explain),
    // the test questions too: they come per session from the server (its own form), never with the page
    ...JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.map((q) => q.prompt),
    ...bundle.nodes.flatMap((n) => n.facts.map((f) => f.text)),
  ].map((t) => t.slice(0, 40));
  const leaked = secrets.filter((t) => shipped.includes(t));
  check(!leaked.length, `the browser bundle holds no solution, explanation, test question or lesson fact (${secrets.length} checked${leaked.length ? `; found: ${leaked.slice(0, 3).join(" | ")}` : ""})`);
}

await browser.close();
stopServer();
console.log(checks.join("\n"));
console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
process.exit(checks.some((c) => c.startsWith("✗")) || errors.length ? 1 : 0);
