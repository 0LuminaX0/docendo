// The README's screenshots, one per step of a session, written to docs/.
//   pnpm build && pnpm shots
// Starts its own server from the build on port 3197 with the research log, the admin panel and access codes off.
// With OPENROUTER_API_KEY in .env, Kai is the real one (a few cents of credits); without it, demo mode (and a
// "Demo mode" badge in the shots). Uses your installed Chrome; set CHROME_PATH if it isn't in the default place.

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "docs");
const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const CODE = "readme-shots";
if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
  console.error("No build found: run pnpm build first.");
  process.exit(1);
}
const exercises = JSON.parse(readFileSync(join(ROOT, "topics/bandits/exercises.json"), "utf8")).items;
const env = { ...process.env, ACCESS_CODE: CODE, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "", ADMIN_PASSWORD: "", CODE_SECRET: "", SESSION_TURNS_PER_MIN: "200" };
const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
};
process.on("exit", stop);
for (let i = 0; !(await fetch(BASE).then(() => true, () => false)); i++) {
  if (i > 60) throw new Error("the server didn't start");
  await new Promise((r) => setTimeout(r, 500));
}

const CHROME = process.env.CHROME_PATH ?? { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ?? "/usr/bin/google-chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const p = await browser.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const images = () => p.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 10000 }).catch(() => {});
const shot = async (name) => (await images(), await wait(500), await p.screenshot({ path: join(OUT, `${name}.png`) }), console.log(`docs/${name}.png`));

// 1. welcome
await p.goto(BASE, { waitUntil: "load" });
await p.waitForSelector("#code");
await shot("welcome");
await p.type("#code", CODE);
await p.click(".consent input");
await p.click("button[type=submit]");

// pretest (not shown): "I don't know" throughout
await p.waitForFunction(() => location.pathname === "/pretest");
await p.waitForSelector(".q");
const n = (await p.$$(".q")).length;
for (let i = 0; i < n; i++) await p.$eval(`.q:nth-child(${i + 1}) .opt:last-child input`, (el) => el.click());
await p.click(".submitbar .btn.primary");

// 2. watch
await p.waitForFunction(() => location.pathname === "/watch");
await wait(2500);
await shot("watch");
await p.click(".aside .btn.primary");
await p.waitForSelector(".aside .btn.primary.small");
await p.click(".aside .btn.primary.small");

// 3. teach Kai: a learner explaining in their own words
await p.waitForSelector("#msg");
const say = [
  "Imagine you eat out every night and there are three restaurants. You don't know which one is best, and each visit is a bit random, so you only find out how good a place is by eating there.",
  "For each restaurant you keep the average of how good your meals there were. That average is your guess of how good the place really is.",
  "Greedy simply goes to the restaurant with the best average so far, every night. It never tries the others again just to learn more about them.",
  "That's the catch: if the best place gives you one bad meal at the start, its average looks bad, greedy never goes back, and you can be stuck at a worse place for good.",
  "Epsilon-greedy fixes that. Most nights it takes the best average, but with a small probability, say 10%, it picks a restaurant at random, any of them, even ones it already knows are bad.",
];
for (let t = 0; t < say.length; t++) {
  await p.focus("#msg");
  await p.keyboard.type(say[t]);
  await p.keyboard.press("Enter");
  await p.waitForFunction((k) => { const s = JSON.parse(localStorage.getItem("docendo:session:v1")); return s.chat.state?.turn === k && s.chat.turns.filter((x) => x.role === "kai").length > k; }, { timeout: 60000 }, t + 1);
}
await wait(1500);
await shot("teach");

// 4. Kai's mind
await p.click(".seg button:nth-child(2)");
await p.waitForSelector(".mind svg");
await wait(800);
await shot("mind");
await p.click(".seg button:nth-child(1)");
await p.waitForSelector(".skip");
await p.click(".skip");
await p.waitForSelector(".composer-foot .row .btn.small");
await p.click(".composer-foot .row .btn.small");
await p.waitForSelector(".ready .btn.primary");
await p.click(".ready .btn.primary");

// 5. practice, direct feedback: the learner's own try, with working
await p.waitForFunction(() => location.pathname === "/practice");
await p.waitForSelector(".pq");
await p.$eval(".submitbar .btn", (e) => e.click()); // to problem 2 (an explore day)
await p.waitForFunction(() => document.querySelectorAll(".prog li")[1]?.classList.contains("now"));
await p.focus(".pq textarea");
await p.keyboard.type("Explore day: the pick is random over all three trucks, so A, B and C each have 1 in 3.");
await p.$eval(".opt:nth-child(3) input", (e) => e.click());
await p.click(".pact .btn");
await p.waitForSelector(".bulb.on, .bulb.off");
await wait(400);
await shot("practice");

// 6. practice, recursive feedback: Kai solves the UCB problem it wasn't taught, is corrected, tries again
await p.$eval(".submitbar .btn", (e) => e.click()); // to problem 3 (UCB)
await p.waitForFunction(() => document.querySelectorAll(".prog li")[2]?.classList.contains("now"));
await p.click(".seg button:nth-child(2)");
await p.waitForSelector(".kcall button", { timeout: 90000 });
await p.$eval(".kcall button:last-of-type", (e) => e.click());
await p.waitForSelector(".kattempt .light");
const kaiRight = await p.$eval(".kattempt .light", (e) => e.classList.contains("on"));
if (!kaiRight) {
  await p.waitForSelector(".ks-fix textarea");
  await p.focus(".ks-fix textarea");
  await p.keyboard.type("UCB adds a bonus to each truck's average, bigger for trucks you've tried less, and picks the truck with the highest average plus bonus.");
  await wait(600);
  await shot("practice-kai-correct");
  await p.$eval(".ks-fix .btn.primary", (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll(".kattempt").length === 2, { timeout: 90000 });
  await p.waitForSelector(".kcall button", { timeout: 90000 });
  await p.$eval(".kcall button:first-of-type", (e) => e.click());
  await wait(1500);
}
// point at a step of Kai's (last) try: the notebook scrolls to the lines it used and highlights them
const tries = await p.$$(".kattempt");
const steps = tries.length ? await tries.at(-1).$$(".ksteps li") : [];
if (steps.length) await steps[0].hover();
await wait(900);
await shot("practice-kai");

// 7. final test (back to "You solve", so Kai doesn't start on the problems skipped on the way)
await p.click(".seg button:nth-child(1)");
for (let k = 3; k < 6; k++) {
  await p.$eval(".submitbar .btn", (e) => e.click());
  await p.waitForFunction((i) => document.querySelectorAll(".prog li")[i]?.classList.contains("now"), {}, k);
}
await p.$eval(".submitbar .btn", (e) => e.click());
await p.waitForFunction(() => location.pathname === "/exercises", { timeout: 20000 });
await p.waitForSelector(".q");
const shown = await p.$$eval(".q", (els) => els.map((e) => e.dataset.q));
for (const id of shown) {
  const t = exercises.find((x) => x.id === id);
  const c = await p.$(`.q[data-q="${id}"]`);
  if (t.kind === "number") await c.$eval(".qans input", (el) => el.focus()), await p.keyboard.type(String(t.answer));
  else await c.$eval(`.opt:nth-child(${t.answer + 1}) input`, (el) => el.click());
}
// working that belongs to the question: the calculation its answer comes from
const WORK = { q01: "(4 × 12 + 22) / 5 =", q05: "1000 × 0.2 / 4 =", q08: "0.6 + √(2 × 3.91 / 8) =", r01: "(5 × 18 + 30) / 6 =", r05: "2000 × 0.15 / 5 =", r08: "3.2 + √(2 × 3.4 / 5) =" };
const num = shown.find((id) => WORK[id]);
await p.$eval(`.q[data-q="${num}"]`, (e) => (e.scrollIntoView({ block: "start" }), scrollBy(0, -90)));
await p.$eval(`.q[data-q="${num}"] .qwork textarea`, (el) => el.focus());
await p.keyboard.type(WORK[num]);
await wait(500);
await shot("test");
await p.click(".submitbar .btn.primary");

// 8. results (after the questions about the session)
await p.waitForFunction(() => location.pathname === "/results");
await p.waitForSelector(".survey");
await p.$eval(".survey-skip", (b) => b.click());
await p.waitForSelector(".big");
// the review: each answer with its explanation, then the practice's worked solutions
await p.$eval(".review-head", (e) => (e.scrollIntoView({ block: "start" }), scrollBy(0, -84)));
await shot("results");

await browser.close();
stop();
