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
// what a learner might write as the reason, by the rule an item is about
const REASON = {
  Greedy: "Greedy keeps trying the option whose average is too high until it falls, so it ends up on the best one.",
  UCB: "The bonus shrinks each time an option is picked and grows again slowly while it isn't.",
  Comparison: "Both go by the averages, but UCB adds a bonus that depends only on the tries and the round.",
};
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
// the shared code's debug skip (components/DebugSkip.tsx) is for the team, not for the README's pictures
await p.evaluateOnNewDocument(() => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: ".debug-skip, .debug-mind, .voice-intro-back { display: none !important; }" }))));
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

// the team's skip (hidden in the pictures): on to the next step
const skip = async (path) => (await p.$eval(".debug-skip", (b) => b.click()), p.waitForFunction((x) => location.pathname === x, { timeout: 20000 }, path));

// 2. read: the greedy chapter, with its day-by-day figure
await p.waitForFunction(() => location.pathname === "/watch");
await p.waitForSelector(".lesson");
await p.$eval(".debug-skip", (b) => b.click()); // to chapter 2
await wait(1200);
await p.$eval(".lesson-fig", (e) => (e.scrollIntoView({ block: "center" })));
await wait(400);
await shot("read");
await p.$eval(".debug-skip", (b) => b.click()); // to chapter 3
await wait(800);
await skip("/teach");

// 3. teach Kai: answers to its questions in a learner's own words (greedy taught the way a pilot learner did)
await p.waitForSelector("#msg");
const say = [
  "Each round you pick one of a few options, like a food truck for lunch. Each one gives a random result around its own average, which you don't know, and you only see the result of the one you picked.",
  "Greedy tries every option once and then goes with whichever one scored best in that first round.",
  "If the best truck has one unlucky first lunch, its average looks bad and greedy never goes back to it, so that average never gets corrected.",
  "Yes: you might learn that an option is better than it looked. Picking the best-looking one collects reward now, trying another one is how you find out.",
  "UCB gives each option a score, its average plus a bonus, and always picks the option with the highest score.",
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
await wait(500);
await skip("/practice");

// 5. practice, direct feedback: the learner's own try at problem 1, with working
await p.waitForSelector(".pq");
await p.focus(".pq textarea");
await p.keyboard.type("B's average after day 4: (9 + 5) / 2 = 7, below A's 7.5, so greedy switches to A.");
await p.$eval(".opt:nth-child(2) input", (e) => e.click());
await p.click(".pact .btn");
await p.waitForSelector(".bulb.on, .bulb.off");
await wait(400);
await shot("practice");

// 6. practice, recursive feedback: Kai solves problem 1 from what it was taught (greedy "goes with the first round's
// winner"), the learner calls it, corrects it, and Kai tries again
await p.click(".seg button:nth-child(2)");
await p.waitForSelector(".kcall button", { timeout: 90000 });
await p.$eval(".kcall button:last-of-type", (e) => e.click());
await p.waitForSelector(".kattempt .light");
const kaiRight = await p.$eval(".kattempt .light", (e) => e.classList.contains("on"));
if (!kaiRight) {
  await p.waitForSelector(".ks-fix textarea");
  await p.focus(".ks-fix textarea");
  await p.keyboard.type("Greedy doesn't stay with the first winner: it updates the average of the option it picks, and as soon as another option's average is higher it switches to that one.");
  await wait(600);
  await shot("practice-kai-correct");
  await p.$eval(".ks-fix .btn.primary", (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll(".kattempt").length === 2, { timeout: 90000 });
  await p.waitForSelector(".kcall button", { timeout: 90000 });
  await p.$eval(".kcall button:first-of-type", (e) => e.click());
  await wait(1500);
}
const tries = await p.$$(".kattempt");
const steps = tries.length ? await tries.at(-1).$$(".ksteps li") : [];
if (steps.length) await steps[0].hover();
await wait(900);
await shot("practice-kai");

await browser.close();
